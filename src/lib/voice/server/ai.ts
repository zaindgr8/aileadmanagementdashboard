import 'server-only';
import { geminiConfigured, GeminiError, geminiJson, type GeminiSchema } from '@/lib/ai/gemini';
import { fmt, outcomeOf } from '@/lib/voice/calls';
import { STAGE_KEYS } from '@/lib/voice/leads';
import type { CallDetail, Lead, LeadBrief, LeadNote } from '@/lib/voice/types';
import { HttpError } from './http';

/** AI briefs run on Gemini (GEMINI_API_KEY). */
export const aiEnabled = () => geminiConfigured;

const BRIEF_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING', description: '2-4 sentences: who this lead is, what they want, and where things stand.' },
    intent: { type: 'STRING', enum: ['high', 'medium', 'low', 'none'], description: 'Buying intent shown in the conversations.' },
    suggested_stage: { type: 'STRING', enum: STAGE_KEYS },
    next_action: { type: 'STRING', description: 'The single most useful next step for the sales rep, as an imperative sentence.' },
    talking_points: { type: 'ARRAY', maxItems: 4, items: { type: 'STRING' }, description: 'Up to 4 specific points to raise on the next contact.' },
    objections: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Concerns or objections the lead raised, if any.' },
    best_follow_up: { type: 'STRING', description: 'When and how to follow up, based on what the lead said and when they answered.' },
  },
  required: ['summary', 'intent', 'suggested_stage', 'next_action', 'talking_points', 'objections', 'best_follow_up'],
};
type BriefOut = Omit<LeadBrief, 'at' | 'calls'>;

const SYSTEM = `You are a sales assistant inside a CRM for a business that uses AI voice agents to call leads.
You read a lead's call history (summaries and transcripts) and the rep's notes, then write a short, practical brief that helps a human close the deal.
Base everything on the evidence given. Do not invent facts, prices or promises. If the calls contain little information, say so plainly and keep the brief short.
Pipeline stages: new (not called), attempted (no conversation yet), engaged (had a conversation), qualified (clear interest or goal achieved), proposal (offer sent), won, lost (clearly not interested or asked not to be called).`;

function render(lead: Lead, notes: LeadNote[], calls: CallDetail[], totalCalls: number) {
  const lines = [
    `Lead: ${lead.name || 'Unknown name'} (${lead.phone})${lead.company ? `, ${lead.company}` : ''}`,
    `Current stage: ${lead.stage}. Source: ${lead.source}. Calls on record: ${totalCalls} (${lead.answered} answered, ${lead.inbound} inbound).`,
    `Today: ${new Date().toISOString().slice(0, 10)}`,
  ];
  if (notes.length) lines.push('', 'Rep notes (newest first):', ...notes.slice(0, 20).map((n) => `- ${new Date(n.at).toISOString().slice(0, 10)}: ${n.text}`));
  for (const c of calls) {
    lines.push('', `--- Call ${c.start ? new Date(c.start).toISOString() : ''} · ${c.direction ?? ''} · ${outcomeOf(c)} · ${fmt.dur(c.duration_ms)} · sentiment ${c.sentiment ?? 'n/a'} ---`);
    if (c.summary) lines.push(`Summary: ${c.summary}`);
    const custom = Object.entries(c.analysis?.custom_analysis_data ?? {}).filter(([, v]) => v != null && v !== '');
    if (custom.length) lines.push(`Extracted data: ${custom.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('; ')}`);
    if (c.transcript.length) lines.push('Transcript:', ...c.transcript.map((t) => `${t.role === 'user' ? 'Lead' : 'Agent'}: ${t.content}`));
  }
  return lines.join('\n');
}

export async function writeBrief(lead: Lead, notes: LeadNote[], calls: CallDetail[], totalCalls: number): Promise<LeadBrief> {
  if (!aiEnabled()) throw new HttpError(503, 'AI briefs are off. Set GEMINI_API_KEY to turn them on.');
  let out: BriefOut;
  try {
    ({ data: out } = await geminiJson<BriefOut>({ system: SYSTEM, prompt: render(lead, notes, calls, totalCalls), schema: BRIEF_SCHEMA, thinking: 'medium', timeoutMs: 90_000 }));
  } catch (err) {
    if (err instanceof GeminiError) {
      console.error('Gemini error', err.status, err.message);
      throw new HttpError(err.status === 429 ? 429 : err.status === 422 ? 422 : err.status === 503 ? 503 : 502,
        err.status === 429 ? 'The AI service is busy. Try again in a minute.' : err.status === 422 ? 'The AI declined to summarise this lead.' : err.status === 503 ? 'The Gemini API key was rejected.' : 'The AI service returned an error.');
    }
    throw err;
  }
  return { ...out, talking_points: (out.talking_points ?? []).slice(0, 4), objections: out.objections ?? [], at: Date.now(), calls: totalCalls };
}
