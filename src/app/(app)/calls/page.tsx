'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BarChart, HBars, Legend, type Bucket } from '@/components/voice/charts';
import { CallsTable, LoadingBlocks } from '@/components/voice/calls-ui';
import { useDashboard, useTip } from '@/components/voice/dashboard-context';
import { NextAction, ScoreBadge, StageBadge } from '@/components/voice/leads-ui';
import { STAGES } from '@/lib/voice/leads';
import { api } from '@/lib/voice/calls';
import { endedBecause, fmt, isAnswered, outcomeOf, summarize } from '@/lib/voice/calls';
import type { Lead, LeanCall } from '@/lib/voice/types';

function Delta({ cur, prev, invert = false, isRate = false }: { cur: number; prev: number; invert?: boolean; isRate?: boolean }) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || (!isRate && prev === 0)) return null;
  const d = isRate ? cur - prev : (cur - prev) / prev;
  if (Math.abs(d) < 0.005) return <span className="muted">no change</span>;
  const up = d > 0;
  const text = isRate ? `${up ? '+' : ''}${(d * 100).toFixed(1)} pts` : `${up ? '+' : ''}${(d * 100).toFixed(0)}%`;
  return <span className={(invert ? !up : up) ? 'delta-up' : 'delta-down'}>{up ? '▲' : '▼'} {text}</span>;
}

function Kpi({ label, value, sub, hero }: { label: string; value: string; sub?: React.ReactNode; hero?: boolean }) {
  return (
    <div className={`kpi${hero ? ' hero' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/** Pipeline counts and the leads that need attention first. */
function PipelinePanel() {
  const { leadsVersion, openLead } = useDashboard();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ leads: Lead[] }>('/api/voice/leads').then((r) => { if (!cancelled) setLeads(r.leads); }).catch(() => { if (!cancelled) setLeads([]); });
    return () => { cancelled = true; };
  }, [leadsVersion]);
  if (!leads) return <div className="card skeleton" style={{ height: 180 }} />;
  if (!leads.length) return null;
  const count = (k: string) => leads.filter((l) => l.stage === k).length;
  const urgent = leads.filter((l) => l.next_action.urgency === 'high').slice(0, 5);
  return (
    <div className="cards cards-2">
      <div className="card">
        <div className="card-head"><h2>Lead pipeline</h2><p className="muted">all time · {leads.length} active leads</p><span className="spacer" /><Link className="btn btn-sm" href="/calls/leads">Open pipeline</Link></div>
        <div className="pipeline-strip">
          {STAGES.map((s) => (
            <Link key={s.key} href="/calls/leads" title={s.hint}><span className="tiny muted">{s.label}</span><strong>{fmt.n(count(s.key))}</strong></Link>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Today&apos;s priorities</h2><p className="muted">leads to act on first</p></div>
        {urgent.length ? (
          <div className="timeline">
            {urgent.map((l) => (
              <button key={l.phone} className="timeline-item" onClick={() => openLead(l.phone)}>
                <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <strong className="ellipsis">{l.name || l.phone}</strong><span className="spacer" /><StageBadge stage={l.stage} /><ScoreBadge lead={l} />
                </div>
                <NextAction action={l.next_action} />
              </button>
            ))}
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>Nothing urgent. Nice work.</p>}
      </div>
    </div>
  );
}

function volumeBuckets(calls: LeanCall[], days: number, nowMs: number): Bucket[] {
  const now = new Date(nowMs);
  const ranges: { start: number; end: number; label: string; short: string }[] = [];
  if (days <= 1) {
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() - i);
      ranges.push({ start: +d, end: +d + 3600_000, label: d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric' }), short: d.toLocaleTimeString(undefined, { hour: 'numeric' }) });
    }
  } else {
    const weekly = days > 90;
    const size = (weekly ? 7 : 1) * 86400_000;
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const count = weekly ? Math.ceil(days / 7) : days;
    for (let i = count - 1; i >= 0; i--) {
      const s = +today - i * size;
      const d = new Date(s);
      const short = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      ranges.push({ start: s, end: s + size, short, label: weekly ? `Week of ${short}` : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) });
    }
  }
  return ranges.map((r) => {
    const inRange = calls.filter((c) => c.start && c.start >= r.start && c.start < r.end);
    const a = inRange.filter(isAnswered).length;
    return { label: r.label, short: r.short, values: [a, inRange.length - a] };
  });
}

export default function OverviewPage() {
  const { calls, prevCalls, loaded, loadedAt, days, setHistory } = useDashboard();
  const router = useRouter();
  const tip = useTip();

  const data = useMemo(() => {
    if (!loadedAt) return null;
    const s = summarize(calls);
    const p = summarize(prevCalls);

    const reasons: Record<string, number> = {};
    calls.forEach((c) => { const k = endedBecause(c); reasons[k] = (reasons[k] || 0) + 1; });
    let reasonRows = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
    if (reasonRows.length > 8) reasonRows = [...reasonRows.slice(0, 7), ['Other', reasonRows.slice(7).reduce((t, r) => t + r[1], 0)]];

    const hours = Array.from({ length: 24 }, (_, h) => ({ h, total: 0, ans: 0 }));
    calls.forEach((c) => { if (!c.start) return; const h = new Date(c.start).getHours(); hours[h].total++; if (isAnswered(c)) hours[h].ans++; });
    const active = hours.filter((h) => h.total > 0);
    const first = active[0]?.h ?? 8, last = active.at(-1)?.h ?? 20;
    const hourBuckets: Bucket[] = hours.slice(first, last + 1).map((h) => {
      const label = new Date(2000, 0, 1, h.h).toLocaleTimeString(undefined, { hour: 'numeric' });
      const rate = h.total ? h.ans / h.total : 0;
      return { label, short: label, values: [rate], tip: <><b>{label}</b><div>Answer rate: {fmt.pct(rate)}</div><div>{h.ans} of {h.total} calls answered</div></> };
    });

    const sent = { Negative: 0, Neutral: 0, Positive: 0, Unknown: 0 };
    calls.forEach((c) => { const k = (c.sentiment && c.sentiment in sent ? c.sentiment : 'Unknown') as keyof typeof sent; sent[k]++; });

    const byAgent: Record<string, { name: string; calls: LeanCall[] }> = {};
    calls.forEach((c) => { (byAgent[c.agent_id] ||= { name: c.agent_name || 'Unknown agent', calls: [] }).calls.push(c); });
    const agents = Object.entries(byAgent).map(([id, a]) => ({ id, name: a.name, ...summarize(a.calls) })).sort((a, b) => b.total - a.total);

    return { s, p, reasonRows, hourBuckets, sent, agents, volume: volumeBuckets(calls, days, loadedAt) };
  }, [calls, prevCalls, days, loadedAt]);

  if (!loaded || !data) return <LoadingBlocks />;
  const rangeLabel = days === 1 ? 'last 24 hours' : `last ${days} days`;

  if (!calls.length) {
    return (
      <div className="card empty">
        <strong>No calls in the {rangeLabel}</strong>
        Place a call or launch a campaign to see stats here.
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <Link className="btn btn-primary" href="/calls/new">New call</Link>
          <Link className="btn" href="/calls/bulk">Bulk campaign</Link>
        </div>
      </div>
    );
  }

  const { s, p, sent } = data;
  const known = sent.Negative + sent.Neutral + sent.Positive;
  const segs = [['Negative', 'var(--neg)'], ['Neutral', 'var(--neutral)'], ['Positive', 'var(--pos)']] as const;

  return (
    <>
      <PipelinePanel />
      <div className="kpis">
        <Kpi hero label="Total calls" value={fmt.n(s.total)} sub={<>{s.live ? `${s.live} live now · ` : ''}{s.inbound ? `${fmt.n(s.inbound)} inbound · ` : ''}{rangeLabel}</>} />
        <Kpi label="Answer rate" value={fmt.pct(s.answerRate)} sub={<>{fmt.n(s.answered)} answered <Delta cur={s.answerRate} prev={p.answerRate} isRate /></>} />
        <Kpi label="Talk time" value={fmt.mins(s.talk)} sub={`avg ${fmt.dur(s.avgDur)} per answered call`} />
        <Kpi label="Successful calls" value={fmt.n(s.successful)} sub={<>{fmt.pct(s.successRate)} of answered <Delta cur={s.successful} prev={p.successful} /></>} />
        <Kpi label="Contacts reached" value={fmt.n(s.reached)} sub={`of ${fmt.n(s.unique)} unique numbers dialled`} />
        <Kpi label="Positive sentiment" value={fmt.pct(s.positiveRate)} sub={`${fmt.n(s.positive)} positive conversations`} />
        <Kpi label="Spend" value={fmt.money(s.cost)} sub={<Delta cur={s.cost} prev={p.cost} invert />} />
        <Kpi label="Cost per answered call" value={fmt.money(s.costPerAnswered)} sub={`${fmt.money(s.total ? s.cost / s.total : 0)} per dial`} />
      </div>

      <div className="cards cards-2">
        <div className="card">
          <div className="card-head">
            <h2>Call volume</h2><p className="muted">{days > 90 ? 'per week' : days <= 1 ? 'per hour' : 'per day'}</p>
            <span className="spacer" />
            <Legend items={[{ name: 'Answered', color: 'var(--series-1)' }, { name: 'Not answered', color: 'var(--series-2)' }]} />
          </div>
          <BarChart buckets={data.volume} series={[{ name: 'Answered', color: 'var(--series-1)' }, { name: 'Not answered', color: 'var(--series-2)' }]} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Call outcomes</h2><p className="muted">why calls ended</p></div>
          <HBars rows={data.reasonRows.map(([label, value]) => ({
            label, value, tip: <><b>{label}</b><div>{fmt.n(value)} calls · {fmt.pct(value / calls.length)}</div></>,
          }))} />
        </div>
      </div>

      <div className="cards cards-2">
        <div className="card">
          <div className="card-head"><h2>Best time to call</h2><p className="muted">answer rate by hour of day · your local time</p></div>
          <BarChart buckets={data.hourBuckets} series={[{ name: 'Answer rate', color: 'var(--series-1)' }]} height={220} maxValue={1} yFormat={(v) => `${Math.round(v * 100)}%`} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Customer sentiment</h2><p className="muted">from post-call analysis</p></div>
          {known ? (
            <>
              <div className="split-bar">
                {segs.filter(([k]) => sent[k]).map(([k, c]) => (
                  <span key={k} style={{ width: `${(sent[k] / known) * 100}%`, background: c }} {...tip(<><b>{k}</b><div>{sent[k]} calls · {fmt.pct(sent[k] / known)}</div></>)} />
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                <Legend items={segs.map(([k, c]) => ({ name: k, color: c, extra: <> <strong className="num">{fmt.pct(sent[k] / known)}</strong> <span className="muted">({sent[k]})</span></> }))} />
              </div>
              {sent.Unknown > 0 && <p className="tiny muted" style={{ margin: '14px 0 0' }}>{fmt.n(sent.Unknown)} calls had no conversation to analyse (unanswered or too short).</p>}
              <div style={{ marginTop: 18 }}>
                <HBars rows={[
                  { label: 'Successful', value: s.successful, tip: 'Calls the agent marked as achieving their goal' },
                  { label: 'Voicemail', value: calls.filter((c) => outcomeOf(c) === 'voicemail').length },
                  { label: 'Over 1 minute', value: calls.filter((c) => isAnswered(c) && c.duration_ms >= 60000).length, tip: 'Answered calls that lasted at least a minute' },
                ]} />
              </div>
            </>
          ) : <div className="empty">No analysed conversations yet.</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Agent performance</h2><p className="muted">click an agent to see its calls</p></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th className="right">Calls</th><th className="right">Answer rate</th><th className="right">Avg length</th><th className="right">Success rate</th><th className="right">Positive</th><th className="right">Spend</th></tr></thead>
            <tbody>
              {data.agents.map((a) => (
                <tr key={a.id} onClick={() => { setHistory({ agent: a.id, page: 0 }); router.push('/calls/history'); }}>
                  <td><strong>{a.name}</strong></td>
                  <td className="right num">{fmt.n(a.total)}</td>
                  <td className="right num">{fmt.pct(a.answerRate)}</td>
                  <td className="right num">{fmt.dur(a.avgDur)}</td>
                  <td className="right num">{fmt.pct(a.successRate)}</td>
                  <td className="right num">{fmt.pct(a.positiveRate)}</td>
                  <td className="right num">{fmt.money(a.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Recent calls</h2><span className="spacer" /><Link className="btn btn-sm" href="/calls/history">View all</Link></div>
        <CallsTable calls={calls.slice(0, 6)} compact />
      </div>
    </>
  );
}
