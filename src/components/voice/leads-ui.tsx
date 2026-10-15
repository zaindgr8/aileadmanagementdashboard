'use client';

import { stageLabel } from '@/lib/voice/leads';
import type { Lead, LeadStage, Temperature } from '@/lib/voice/types';

const STAGE_CLS: Record<LeadStage, string> = {
  new: '', attempted: 'warn', engaged: 'info', qualified: 'live', proposal: 'live', won: 'good', lost: 'bad',
};

export const StageBadge = ({ stage }: { stage: LeadStage }) => <span className={`badge ${STAGE_CLS[stage]}`}>{stageLabel(stage)}</span>;

const TEMP: Record<Temperature, { cls: string; label: string }> = {
  hot: { cls: 'bad', label: 'Hot' }, warm: { cls: 'warn', label: 'Warm' }, cold: { cls: 'info', label: 'Cold' },
};

export function ScoreBadge({ lead }: { lead: Pick<Lead, 'score' | 'temperature' | 'stage'> }) {
  if (lead.stage === 'won' || lead.stage === 'lost') return <span className="muted">—</span>;
  const t = TEMP[lead.temperature];
  return <span className={`badge ${t.cls}`} title="Lead score out of 100">{t.label} · <span className="num">{lead.score}</span></span>;
}

export function NextAction({ action }: { action: Lead['next_action'] }) {
  return <span className={`next-action ${action.urgency}`}>{action.text}</span>;
}

/** `Date` → value for <input type="datetime-local"> in local time. */
export function toLocalInput(ts?: number | null) {
  if (!ts) return '';
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function relDay(ts: number, now = Date.now()) {
  const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
  const diff = Math.round((day(ts) - day(now)) / 86400_000);
  const time = new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(Math.abs(diff) > 300 ? { year: 'numeric' } : {}) });
}

export function FollowUp({ ts, now }: { ts?: number | null; now: number }) {
  if (!ts) return <span className="muted">—</span>;
  return <span className={ts <= now ? 'overdue' : ''}>{relDay(ts, now)}</span>;
}
