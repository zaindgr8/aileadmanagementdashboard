import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { fmt, outcomeOf } from '@/lib/voice/calls';
import { STAGE_KEYS } from '@/lib/voice/leads';
import type { CallDetail, Lead, LeadBrief, LeadNote } from '@/lib/voice/types';
import { HttpError } from './http';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const BriefSchema = z.object({
  summary: z.string().describe('2-4 sentences: who this lead is, what they want, and where things stand.'),
  intent: z.enum(['high', 'medium', 'low', 'none']).describe('Buying intent shown in the conversations.'),
  suggested_stage: z.enum(STAGE_KEYS),
  next_action: z.string().describe('The single most useful next step for the sales rep, as an imperative sentence.'),
  talking_points: z.array(z.string()).describe('Up to 4 specific points to raise on the next contact.'),
  objections: z.array(z.string()).describe('Concerns or objections the lead raised, if any.'),
  best_follow_up: z.string().describe('When and how to follow up, based on what the lead said and when they answered.'),
});

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
  if (!aiEnabled()) throw new HttpError(503, 'AI briefs are off. Set ANTHROPIC_API_KEY to turn them on.');
  let res;
  try {
    res = await anthropic().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(BriefSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: render(lead, notes, calls, totalCalls) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The AI service is busy. Try again in a minute.');
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'The Anthropic API key was rejected.');
    if (err instanceof Anthropic.APIError) {
      console.error('Anthropic error', err.status, err.message);
      throw new HttpError(502, 'The AI service returned an error.');
    }
    throw err;
  }
  if (res.stop_reason === 'refusal') throw new HttpError(422, 'The AI declined to summarise this lead.');
  const out = res.parsed_output;
  if (!out) throw new HttpError(502, 'The AI returned an unreadable brief. Try again.');
  return { ...out, talking_points: out.talking_points.slice(0, 4), at: Date.now(), calls: totalCalls };
}
