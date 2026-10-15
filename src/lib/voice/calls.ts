import type { LeanCall } from './types';

// ---------- Formatting ----------

const nf = new Intl.NumberFormat();
export const fmt = {
  n: (v: number) => nf.format(Math.round(v || 0)),
  pct: (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(v < 0.1 && v > 0 ? 1 : 0)}%` : '—'),
  money: (cents: number) => `$${((cents || 0) / 100).toFixed(2)}`,
  dur(ms: number) {
    const s = Math.round((ms || 0) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  },
  mins: (ms: number) => `${nf.format(Math.round((ms || 0) / 60000))} min`,
  date: (ts?: number) =>
    ts ? new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—',
};

// ---------- Call semantics ----------

const REASONS: Record<string, string> = {
  user_hangup: 'Customer hung up', agent_hangup: 'Agent ended call', call_transfer: 'Transferred',
  voicemail_reached: 'Voicemail', inactivity: 'No response', max_duration_reached: 'Max duration',
  dial_busy: 'Line busy', dial_no_answer: 'No answer', dial_failed: 'Dial failed', user_declined: 'Declined',
  invalid_destination: 'Invalid number', telephony_provider_permission_denied: 'Carrier blocked',
  telephony_provider_unavailable: 'Carrier unavailable', concurrency_limit_reached: 'Concurrency limit',
  no_valid_payment: 'Billing issue', scam_detected: 'Flagged as scam', error_retell: 'System error',
  error_unknown: 'Unknown error', registered_call_timeout: 'Timed out', ivr_reached: 'IVR reached',
  machine_detected: 'Machine detected', sip_routing_error: 'Routing error',
};
export const reasonLabel = (r?: string) =>
  REASONS[r ?? ''] || (r ? r.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');

export const isLive = (c: LeanCall) => c.status === 'ongoing' || c.status === 'registered';
export const isAnswered = (c: LeanCall) =>
  c.status === 'ended' && c.duration_ms > 0 && !c.voicemail && c.reason !== 'voicemail_reached';

export type Outcome = 'live' | 'voicemail' | 'answered' | 'missed';
export function outcomeOf(c: LeanCall): Outcome {
  if (isLive(c)) return 'live';
  if (c.voicemail || c.reason === 'voicemail_reached') return 'voicemail';
  return isAnswered(c) ? 'answered' : 'missed';
}
export const endedBecause = (c: LeanCall) => (isLive(c) ? 'In progress' : reasonLabel(c.reason));

export const isInbound = (c: LeanCall) => c.direction === 'inbound';
/** The customer's number: the caller on inbound calls, the callee on outbound ones. */
export const contactNumber = (c: LeanCall) => (isInbound(c) ? c.from : c.to);

export function contactName(c: LeanCall) {
  const v = c.vars || {};
  const key = Object.keys(v).find((k) => /name/i.test(k) && v[k]);
  return key ? v[key] : '';
}

export interface Summary {
  total: number; answered: number; answerRate: number; talk: number; avgDur: number; cost: number;
  costPerAnswered: number; successful: number; successRate: number; positive: number; positiveRate: number;
  live: number; unique: number; reached: number; inbound: number;
}

export function summarize(calls: LeanCall[]): Summary {
  const answered = calls.filter(isAnswered);
  const talk = answered.reduce((s, c) => s + c.duration_ms, 0);
  const cost = calls.reduce((s, c) => s + c.cost_cents, 0);
  const withSentiment = calls.filter((c) => c.sentiment && c.sentiment !== 'Unknown');
  const positive = withSentiment.filter((c) => c.sentiment === 'Positive').length;
  const successful = calls.filter((c) => c.successful === true).length;
  return {
    total: calls.length,
    answered: answered.length,
    answerRate: calls.length ? answered.length / calls.length : NaN,
    talk,
    avgDur: answered.length ? talk / answered.length : 0,
    cost,
    costPerAnswered: answered.length ? cost / answered.length : 0,
    successful,
    successRate: answered.length ? successful / answered.length : NaN,
    positive,
    positiveRate: withSentiment.length ? positive / withSentiment.length : NaN,
    live: calls.filter(isLive).length,
    unique: new Set(calls.map(contactNumber)).size,
    reached: new Set(answered.map(contactNumber)).size,
    inbound: calls.filter(isInbound).length,
  };
}

// ---------- Phone numbers & CSV ----------

export function normalizePhone(raw: string | undefined, cc?: string) {
  let s = String(raw ?? '').trim().replace(/[\s().-]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    const code = String(cc ?? '').replace(/\D/g, '');
    if (code && s.startsWith('0')) s = `+${code}${s.slice(1)}`;
    else if (code && s.length <= 10) s = `+${code}${s}`;
    else s = `+${s}`;
  }
  return s;
}
export const validPhone = (s: string) => /^\+[1-9]\d{6,14}$/.test(s);

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  // Pick the delimiter the header row uses most (comma, semicolon or tab).
  const firstLine = text.split('\n')[0];
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function detectPhoneColumn(headers: string[]) {
  let best = 0, idx = 0;
  headers.forEach((h, i) => {
    const s = h.toLowerCase();
    const score = /^(to_?number|phone_?number|phone|mobile|cell|msisdn)$/.test(s) ? 3 : /phone|mobile|number|tel|contact/.test(s) ? 2 : 0;
    if (score > best) { best = score; idx = i; }
  });
  return idx;
}

export function downloadText(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** One CSV cell, quoted as needed and safe to open in a spreadsheet. */
export function csvCell(v: unknown) {
  let s = String(v ?? '');
  // Neutralise formulas, but leave plain numbers like +971501234567 or -12.5 alone.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d\s.]*$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCallsCsv(calls: LeanCall[]) {
  const varKeys = [...new Set(calls.flatMap((c) => Object.keys(c.vars || {})))];
  const cols = ['call_id', 'started_at', 'direction', 'agent', 'from', 'to', 'status', 'outcome', 'end_reason', 'duration_seconds', 'sentiment', 'successful', 'cost_usd', 'summary', ...varKeys];
  const cell = csvCell;
  const lines = [cols.join(',')].concat(calls.map((c) => [
    c.id, c.start ? new Date(c.start).toISOString() : '', c.direction, c.agent_name, c.from, c.to, c.status, outcomeOf(c), c.reason,
    Math.round(c.duration_ms / 1000), c.sentiment, c.successful, (c.cost_cents / 100).toFixed(2), c.summary,
    ...varKeys.map((k) => c.vars?.[k]),
  ].map(cell).join(',')));
  downloadText(`calls-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth') {
    window.location.assign(new URL('/login', window.location.origin));
    throw new Error('Please sign in');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}
