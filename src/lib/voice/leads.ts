import { contactName, contactNumber, isAnswered, isInbound, isLive, outcomeOf } from './calls';
import type { LeanCall, Lead, LeadRecord, LeadStage, Temperature } from './types';

export const STAGES: { key: LeadStage; label: string; hint: string }[] = [
  { key: 'new', label: 'New', hint: 'Not called yet' },
  { key: 'attempted', label: 'Attempted', hint: 'Called, no conversation yet' },
  { key: 'engaged', label: 'Engaged', hint: 'Had a conversation' },
  { key: 'qualified', label: 'Qualified', hint: 'Interested / goal achieved' },
  { key: 'proposal', label: 'Proposal', hint: 'Offer or quote sent' },
  { key: 'won', label: 'Won', hint: 'Closed deal' },
  { key: 'lost', label: 'Lost', hint: 'Not interested' },
];
export const STAGE_KEYS = STAGES.map((s) => s.key) as [LeadStage, ...LeadStage[]];
export const stageLabel = (s: LeadStage) => STAGES.find((x) => x.key === s)?.label ?? s;
const order = (s: LeadStage) => STAGE_KEYS.indexOf(s);
export const isClosed = (s: LeadStage) => s === 'won' || s === 'lost';

const DAY = 86400_000;

/** Values in Retell's post-call extraction that signal buying interest. */
const INTEREST_KEY = /interest|intent|qualif|appoint|book|meeting|demo|callback|purchase|buy/i;
const YES = /^(true|yes|y|high|interested|booked|confirmed|qualified)$/i;
function interestSignal(c: LeanCall) {
  return Object.entries(c.custom ?? {}).some(([k, v]) => INTEREST_KEY.test(k) && (v === true || YES.test(String(v).trim())));
}

/** Group calls by the customer's number, newest call first. */
export function callsByContact(calls: LeanCall[]) {
  const map = new Map<string, LeanCall[]>();
  for (const c of calls) {
    const n = contactNumber(c);
    if (!n) continue;
    const list = map.get(n);
    if (list) list.push(c); else map.set(n, [c]);
  }
  map.forEach((list) => list.sort((a, b) => (b.start ?? 0) - (a.start ?? 0)));
  return map;
}

function autoStage(calls: LeanCall[]): LeadStage {
  if (!calls.length) return 'new';
  if (calls.some((c) => c.successful === true || interestSignal(c))) return 'qualified';
  if (calls.some(isAnswered)) return 'engaged';
  return 'attempted';
}

function score(rec: LeadRecord | undefined, calls: LeanCall[], stage: LeadStage, now: number) {
  const reasons: string[] = [];
  if (stage === 'won') return { score: 100, reasons: ['Deal won'] };
  if (stage === 'lost') return { score: 0, reasons: ['Marked as lost'] };
  let s = 10;
  const add = (pts: number, why: string) => { s += pts; reasons.push(`${pts > 0 ? '+' : ''}${pts} ${why}`); };
  const answered = calls.filter(isAnswered);
  const last = calls[0];
  if (answered.length) add(Math.min(30, answered.length * 12), `${answered.length} conversation${answered.length > 1 ? 's' : ''}`);
  if (calls.some((c) => c.successful === true)) add(20, 'agent goal achieved');
  if (calls.some(interestSignal)) add(15, 'interest detected in call data');
  if (calls.some(isInbound)) add(15, 'they called you');
  const talk = answered.reduce((t, c) => t + c.duration_ms, 0);
  if (talk >= 120_000) add(10, 'over 2 min talk time');
  const lastSent = answered[0]?.sentiment;
  if (lastSent === 'Positive') add(15, 'positive last conversation');
  if (lastSent === 'Negative') add(-20, 'negative last conversation');
  if (stage === 'proposal') add(15, 'proposal stage');
  if (rec?.brief?.intent === 'high') add(15, 'AI: high buying intent');
  else if (rec?.brief?.intent === 'medium') add(5, 'AI: some buying intent');
  else if (rec?.brief?.intent === 'none') add(-15, 'AI: no buying intent');
  if (last?.start) {
    const age = now - last.start;
    if (age < 3 * DAY) add(10, 'contacted in last 3 days');
    else if (age > 30 * DAY) add(-10, 'no contact for 30+ days');
  }
  if (!answered.length && calls.length >= 3) add(-15, `${calls.length} unanswered attempts`);
  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons };
}

const temperature = (n: number): Temperature => (n >= 60 ? 'hot' : n >= 30 ? 'warm' : 'cold');

function nextAction(lead: Omit<Lead, 'next_action'>, calls: LeanCall[], now: number): Lead['next_action'] {
  if (lead.live) return { text: 'Call in progress', urgency: 'low' };
  if (lead.stage === 'won') return { text: 'Onboard and ask for a referral', urgency: 'low' };
  if (lead.stage === 'lost') return { text: 'No action needed', urgency: 'low' };
  if (lead.follow_up_at && lead.follow_up_at <= now) return { text: 'Follow-up is due', urgency: 'high' };
  const last = calls[0];
  if (last && isInbound(last) && !isAnswered(last)) return { text: 'Call back: they tried to reach you', urgency: 'high' };
  if (lead.stage === 'proposal') return { text: 'Chase the proposal and close', urgency: 'high' };
  if (lead.stage === 'qualified') return { text: 'Send an offer or book a meeting', urgency: 'high' };
  if (lead.follow_up_at) return { text: 'Follow-up scheduled', urgency: 'low' };
  if (lead.last_sentiment === 'Negative') return { text: 'Review the transcript before re-contacting', urgency: 'medium' };
  if (lead.stage === 'engaged') return { text: 'Schedule a follow-up call', urgency: 'medium' };
  if (lead.stage === 'attempted') {
    return lead.calls >= 3
      ? { text: 'Try another channel (SMS, email)', urgency: 'low' }
      : { text: 'Retry at a different time of day', urgency: 'medium' };
  }
  return { text: 'Make the first call', urgency: 'medium' };
}

export function buildLead(phone: string, rec: LeadRecord | undefined, calls: LeanCall[], now = Date.now()): Lead {
  const auto = autoStage(calls);
  const last = calls[0];
  const lastContact = last?.start;
  // A manual stage sticks, unless newer calls have moved the lead further along.
  let stage: LeadStage = rec?.stage ?? auto;
  if (rec?.stage && !isClosed(rec.stage) && order(auto) > order(rec.stage) && (lastContact ?? 0) > (rec.stage_at ?? 0)) stage = auto;
  const answered = calls.filter(isAnswered);
  const { score: sc, reasons } = score(rec, calls, stage, now);
  const nameFromCalls = calls.map(contactName).find(Boolean);
  const base: Omit<Lead, 'next_action'> = {
    phone,
    name: rec?.name || nameFromCalls || '',
    email: rec?.email,
    company: rec?.company,
    stage,
    auto_stage: auto,
    stage_manual: !!rec?.stage && stage === rec.stage,
    value: rec?.value,
    tags: rec?.tags ?? [],
    notes_count: rec?.notes?.length ?? 0,
    follow_up_at: rec?.follow_up_at ?? null,
    source: rec?.source || (calls.at(-1) && isInbound(calls.at(-1)!) ? 'Inbound call' : 'Outbound call'),
    created_at: rec?.created_at ?? calls.at(-1)?.start ?? now,
    first_contact: calls.at(-1)?.start,
    last_contact: lastContact,
    calls: calls.length,
    answered: answered.length,
    inbound: calls.filter(isInbound).length,
    outbound: calls.filter((c) => !isInbound(c)).length,
    talk_ms: answered.reduce((t, c) => t + c.duration_ms, 0),
    cost_cents: calls.reduce((t, c) => t + c.cost_cents, 0),
    last_outcome: last ? outcomeOf(last) : undefined,
    last_sentiment: answered[0]?.sentiment,
    last_summary: answered[0]?.summary,
    last_agent: last?.agent_name,
    successful: calls.some((c) => c.successful === true),
    live: calls.some(isLive),
    score: sc,
    temperature: temperature(sc),
    score_reasons: reasons,
    has_brief: !!rec?.brief,
    brief_stale: !!rec?.brief && rec.brief.calls < calls.length,
    archived: !!rec?.archived,
  };
  return { ...base, next_action: nextAction(base, calls, now) };
}

/** Every stored lead plus every number that appears in the calls. */
export function buildLeads(records: Record<string, LeadRecord>, calls: LeanCall[], now = Date.now()): Lead[] {
  const byPhone = callsByContact(calls);
  const phones = new Set([...Object.keys(records), ...byPhone.keys()]);
  return [...phones].map((p) => buildLead(p, records[p], byPhone.get(p) ?? [], now));
}

export const URGENCY_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Work-queue order: urgent first, then hottest, then most recent. */
export function byPriority(a: Lead, b: Lead) {
  return URGENCY_RANK[a.next_action.urgency] - URGENCY_RANK[b.next_action.urgency]
    || b.score - a.score
    || (b.last_contact ?? b.created_at) - (a.last_contact ?? a.created_at);
}
