'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, fmt } from '@/lib/voice/calls';
import type { Batch } from '@/lib/voice/types';

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function CampaignsPage() {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => api<{ batches: Batch[] }>('/api/voice/batches')
      .then((r) => { if (!cancelled) { setBatches(r.batches); setNow(Date.now()); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    load();
    const t = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (error) return <div className="result err">{error}</div>;
  if (!batches) return <div className="card skeleton" style={{ height: 240 }} />;
  if (!batches.length) {
    return (
      <div className="card empty">
        <strong>No campaigns yet</strong>
        Upload a contact list to have your agent call everyone on it.
        <div style={{ marginTop: 16 }}><Link className="btn btn-primary" href="/calls/bulk">Create a campaign</Link></div>
      </div>
    );
  }

  return (
    <>
      <div className="row"><span className="spacer" /><Link className="btn btn-primary" href="/calls/bulk">New campaign</Link></div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Campaign</th><th>Agent</th><th>Starts</th><th>Progress</th><th className="right">Answered</th><th className="right">Not connected</th><th className="right">Successful</th><th className="right">Spend</th></tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const placed = b.placed ?? 0;
                const pct = b.total ? Math.min(100, (placed / b.total) * 100) : 0;
                const scheduled = b.scheduled_at > now;
                const w = b.window?.windows[0];
                const stat = (v?: number, money = false) => (b.statsError || v == null ? '—' : money ? fmt.money(v) : fmt.n(v));
                return (
                  <tr key={b.batch_call_id} className="static">
                    <td><div className="who"><strong>{b.name}</strong><small>{fmt.date(b.created_at)}{b.skipped ? ` · ${b.skipped} skipped` : ''}</small></div></td>
                    <td>{b.agent_name || 'Number default'}</td>
                    <td>
                      {scheduled ? fmt.date(b.scheduled_at) : 'Immediately'}
                      {w && <><br /><small className="muted">{hhmm(w.start)}–{hhmm(w.end)} {b.window?.timezone}</small></>}
                    </td>
                    <td style={{ minWidth: 180 }}>
                      {scheduled ? <span className="badge info">Scheduled</span>
                        : placed >= b.total && !b.ongoing ? <span className="badge good">Complete</span>
                          : <span className="badge live">Running</span>}{' '}
                      <span className="num tiny muted">{fmt.n(placed)} / {fmt.n(b.total)}</span>
                      <div className="meter" style={{ background: 'var(--surface-2)' }}><i style={{ width: `${pct}%` }} /></div>
                    </td>
                    <td className="right num">{stat(b.answered ?? b.ended)}</td>
                    <td className="right num">{stat(b.not_connected)}</td>
                    <td className="right num">{stat(b.successful)}</td>
                    <td className="right num">{stat(b.cost_cents, true)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ margin: '12px 0 0' }}>Progress refreshes from Retell every 20 seconds. Individual calls also appear in Call history.</p>
      </div>
    </>
  );
}
