'use client';

import { useMemo, useState } from 'react';
import { CallsTable, LoadingBlocks } from '@/components/voice/calls-ui';
import { useDashboard } from '@/components/voice/dashboard-context';
import { exportCallsCsv, fmt, outcomeOf } from '@/lib/voice/calls';

const PER_PAGE = 25;

export default function HistoryPage() {
  const { calls, loaded, history: h, setHistory, config } = useDashboard();
  const [q, setQ] = useState(h.q);

  const agents = useMemo(() => {
    const m = new Map(calls.map((c) => [c.agent_id, c.agent_name || 'Unknown agent']));
    if (h.agent && !m.has(h.agent)) m.set(h.agent, config?.agents.find((a) => a.agent_id === h.agent)?.agent_name ?? h.agent);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [calls, h.agent, config]);

  const rows = useMemo(() => {
    const needle = h.q.trim().toLowerCase();
    return calls.filter((c) => {
      if (h.agent && c.agent_id !== h.agent) return false;
      if (h.outcome && outcomeOf(c) !== h.outcome) return false;
      if (h.sentiment && (c.sentiment || 'Unknown') !== h.sentiment) return false;
      if (h.success === 'yes' && c.successful !== true) return false;
      if (h.success === 'no' && c.successful === true) return false;
      if (needle) {
        const hay = [c.to, c.from, c.agent_name, c.summary, c.id, ...Object.values(c.vars || {})].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [calls, h]);

  if (!loaded) return <LoadingBlocks />;

  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const page = Math.min(h.page, pages - 1);
  const slice = rows.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  return (
    <div className="card">
      <div className="filters">
        <input
          type="search" placeholder="Search number, name, summary…" value={q}
          onChange={(e) => { setQ(e.target.value); setHistory({ q: e.target.value, page: 0 }); }}
        />
        <select value={h.agent} onChange={(e) => setHistory({ agent: e.target.value, page: 0 })}>
          <option value="">All agents</option>
          {agents.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <select value={h.outcome} onChange={(e) => setHistory({ outcome: e.target.value, page: 0 })}>
          <option value="">All outcomes</option>
          <option value="answered">Answered</option>
          <option value="missed">Not connected</option>
          <option value="voicemail">Voicemail</option>
          <option value="live">Live now</option>
        </select>
        <select value={h.sentiment} onChange={(e) => setHistory({ sentiment: e.target.value, page: 0 })}>
          <option value="">Any sentiment</option>
          {['Positive', 'Neutral', 'Negative', 'Unknown'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={h.success} onChange={(e) => setHistory({ success: e.target.value, page: 0 })}>
          <option value="">Success: any</option>
          <option value="yes">Successful</option>
          <option value="no">Not successful</option>
        </select>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => exportCallsCsv(rows)} disabled={!rows.length}>Export CSV</button>
      </div>

      {rows.length ? (
        <>
          <CallsTable calls={slice} />
          <div className="pager">
            <span className="muted">{fmt.n(page * PER_PAGE + 1)}–{fmt.n(page * PER_PAGE + slice.length)} of {fmt.n(rows.length)}</span>
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setHistory({ page: page - 1 })}>Previous</button>
            <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setHistory({ page: page + 1 })}>Next</button>
          </div>
        </>
      ) : (
        <div className="empty"><strong>No calls match these filters</strong>Try a wider date range or clear a filter.</div>
      )}
    </div>
  );
}
