'use client';

import { contactName, contactNumber, endedBecause, fmt, isInbound, outcomeOf } from '@/lib/voice/calls';
import type { LeanCall } from '@/lib/voice/types';
import { useDashboard } from './dashboard-context';

export function StatusBadge({ call }: { call: LeanCall }) {
  const o = outcomeOf(call);
  if (o === 'live') return <span className="badge live">{call.status === 'registered' ? 'Dialling' : 'Live'}</span>;
  if (o === 'answered') return <span className="badge good">Answered</span>;
  if (o === 'voicemail') return <span className="badge info">Voicemail</span>;
  if (call.status === 'error') return <span className="badge bad">Error</span>;
  return <span className="badge warn">Not connected</span>;
}

export function SentimentBadge({ sentiment }: { sentiment?: string }) {
  if (!sentiment || sentiment === 'Unknown') return <span className="muted">—</span>;
  const cls = sentiment === 'Positive' ? 'good' : sentiment === 'Negative' ? 'bad' : '';
  return <span className={`badge ${cls}`}>{sentiment}</span>;
}

export function CallsTable({ calls, compact = false, empty = 'No calls yet.' }: { calls: LeanCall[]; compact?: boolean; empty?: string }) {
  const { openCall } = useDashboard();
  if (!calls.length) return <p className="muted" style={{ margin: 0 }}>{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th><th>Contact</th><th>Direction</th><th>Agent</th><th>Status</th><th>Outcome</th><th className="right">Duration</th>
            {!compact && <><th>Sentiment</th><th className="right">Cost</th><th>Summary</th></>}
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => {
            const name = contactName(c);
            const number = contactNumber(c);
            return (
              <tr key={c.id} onClick={() => openCall(c.id)}>
                <td>{fmt.date(c.start)}</td>
                <td><div className="who"><span>{name || number || '—'}</span>{name && <small>{number}</small>}</div></td>
                <td>{isInbound(c) ? <span className="badge info">Inbound</span> : <span className="badge">Outbound</span>}</td>
                <td>{c.agent_name || '—'}</td>
                <td><StatusBadge call={c} /></td>
                <td>{endedBecause(c)}</td>
                <td className="right num">{c.duration_ms ? fmt.dur(c.duration_ms) : '—'}</td>
                {!compact && (
                  <>
                    <td><SentimentBadge sentiment={c.sentiment} /></td>
                    <td className="right num">{fmt.money(c.cost_cents)}</td>
                    <td className="summary"><span>{c.summary}</span></td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function NoNumbersCard() {
  return (
    <div className="card empty">
      <strong>No phone numbers on this account</strong>
      Add or import a number in your Retell workspace, then refresh this page to place calls.
    </div>
  );
}

export function LoadingBlocks() {
  return (
    <>
      <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi skeleton" style={{ height: 100 }} />)}</div>
      <div className="card skeleton" style={{ height: 320 }} />
    </>
  );
}
