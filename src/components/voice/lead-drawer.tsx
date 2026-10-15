'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, endedBecause, fmt, isInbound } from '@/lib/voice/calls';
import { isClosed, STAGES, stageLabel } from '@/lib/voice/leads';
import type { LeadDetail, LeadStage } from '@/lib/voice/types';
import { SentimentBadge, StatusBadge } from './calls-ui';
import { useDashboard } from './dashboard-context';
import { NextAction, relDay, ScoreBadge, StageBadge, toLocalInput } from './leads-ui';

const Close = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z" /></svg>;

const leadUrl = (phone: string, sub = '') => `/api/voice/leads/${encodeURIComponent(phone)}${sub}`;

function at(daysAhead: number, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return +d;
}

export function LeadDrawer() {
  const { openLeadPhone: phone, openLead, openCall, setCallPrefill, bumpLeads, toast, config } = useDashboard();
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!phone) return;
    let cancelled = false;
    // Reset before fetching the newly selected lead.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLead(null);
    setError('');
    setNote('');
    api<LeadDetail>(leadUrl(phone))
      .then((l) => { if (!cancelled) setLead(l); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [phone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') openLead(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openLead]);

  async function run(label: string, fn: () => Promise<LeadDetail | void>, done?: string) {
    setBusy(label);
    try {
      const next = await fn();
      if (next) setLead(next);
      bumpLeads();
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy('');
    }
  }

  const patch = (body: Record<string, unknown>, done?: string) =>
    run('patch', () => api<LeadDetail>(leadUrl(lead!.phone), { method: 'PATCH', body }), done);

  function saveDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = String(f.get('value') ?? '').trim();
    patch({
      name: String(f.get('name') ?? ''),
      email: String(f.get('email') ?? ''),
      company: String(f.get('company') ?? ''),
      value: value ? Number(value) : null,
      tags: String(f.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    }, 'Lead saved').then(() => setFormKey((k) => k + 1));
  }

  function callNow() {
    if (!lead) return;
    setCallPrefill({ to: lead.phone, vars: lead.name ? { customer_name: lead.name } : {} });
    openLead(null);
    router.push('/calls/new');
  }

  const open = !!phone;
  const b = lead?.brief;

  return (
    <>
      {open && <div className="drawer-backdrop" onClick={() => openLead(null)} />}
      <aside className={`drawer drawer-wide${open ? ' open' : ''}`} aria-hidden={!open} aria-label="Lead details">
        <div className="drawer-head">
          <div className="who">
            <h2>{lead?.name || phone || 'Lead'}</h2>
            {lead?.name && <small className="mono">{lead.phone}</small>}
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => openLead(null)}><Close /></button>
        </div>
        {open && (
          <div className="drawer-body">
            {error && <div className="result err">{error}</div>}
            {!lead && !error && <><div className="skeleton" style={{ height: 120 }} /><div className="skeleton" style={{ height: 300 }} /></>}
            {lead && (
              <>
                <div className="row">
                  <StageBadge stage={lead.stage} />
                  <ScoreBadge lead={lead} />
                  {lead.live && <span className="badge live">On a call now</span>}
                  {lead.archived && <span className="badge">Archived</span>}
                  {lead.tags.map((t) => <span key={t} className="chip">{t}</span>)}
                </div>

                <div className={`action-box ${lead.next_action.urgency}`}>
                  <div><span className="section-title">Next step</span><NextAction action={lead.next_action} /></div>
                  <div className="row">
                    <button className="btn btn-primary btn-sm" onClick={callNow} disabled={lead.live}>Call now</button>
                    {lead.stage !== 'won' && <button className="btn btn-sm" disabled={!!busy} onClick={() => patch({ stage: 'won', follow_up_at: null }, 'Marked as won 🎉')}>Mark won</button>}
                    {lead.stage !== 'lost' && <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => patch({ stage: 'lost', follow_up_at: null }, 'Marked as lost')}>Mark lost</button>}
                  </div>
                </div>

                <div className="grid-2">
                  <label className="field"><span>Stage</span>
                    <select value={lead.stage} disabled={!!busy} onChange={(e) => patch({ stage: e.target.value as LeadStage })}>
                      {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}: {s.hint}</option>)}
                    </select>
                    {!lead.stage_manual && <small>Set automatically from calls.</small>}
                  </label>
                  <label className="field"><span>Follow-up</span>
                    <input type="datetime-local" value={toLocalInput(lead.follow_up_at)} disabled={!!busy}
                      onChange={(e) => patch({ follow_up_at: e.target.value ? new Date(e.target.value).getTime() : null })} />
                    <span className="row" style={{ gap: 6 }}>
                      {[['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([l, d]) => (
                        <button key={l} type="button" className="btn btn-sm btn-ghost chip-btn" disabled={!!busy} onClick={() => patch({ follow_up_at: at(Number(d)) }, `Follow-up set for ${relDay(at(Number(d)))}`)}>{l}</button>
                      ))}
                      {lead.follow_up_at && <button type="button" className="btn btn-sm btn-ghost chip-btn" disabled={!!busy} onClick={() => patch({ follow_up_at: null })}>Clear</button>}
                    </span>
                  </label>
                </div>

                <div className="facts">
                  <div className="fact"><span>Calls</span><strong className="num">{lead.calls} <small className="muted">({lead.answered} answered{lead.inbound ? `, ${lead.inbound} inbound` : ''})</small></strong></div>
                  <div className="fact"><span>Talk time</span><strong>{fmt.dur(lead.talk_ms)}</strong></div>
                  <div className="fact"><span>Last contact</span><strong>{lead.last_contact ? fmt.date(lead.last_contact) : 'Never'}</strong></div>
                  <div className="fact"><span>Source</span><strong>{lead.source}</strong></div>
                </div>

                <section>
                  <div className="row" style={{ marginBottom: 8 }}>
                    <span className="section-title" style={{ margin: 0 }}>AI brief</span>
                    {b && <span className="tiny muted">written {relDay(b.at)}{lead.brief_stale ? ' · new calls since' : ''}</span>}
                    <span className="spacer" />
                    {config?.aiEnabled && (
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => run('brief', () => api<LeadDetail>(leadUrl(lead.phone, '/brief'), { method: 'POST' }), 'AI brief ready')}>
                        {busy === 'brief' ? 'Analysing calls…' : b ? 'Refresh' : 'Generate brief'}
                      </button>
                    )}
                  </div>
                  {!config?.aiEnabled && <p className="tiny muted" style={{ margin: 0 }}>Add <span className="mono">ANTHROPIC_API_KEY</span> to the server settings to get AI summaries, buying intent and talking points for each lead.</p>}
                  {config?.aiEnabled && !b && busy !== 'brief' && <p className="tiny muted" style={{ margin: 0 }}>Reads this lead&apos;s calls and notes, then tells you their intent, objections and what to say next.</p>}
                  {busy === 'brief' && <div className="skeleton" style={{ height: 120 }} />}
                  {b && busy !== 'brief' && (
                    <div className="brief">
                      <p>{b.summary}</p>
                      <div className="row">
                        <span className={`badge ${b.intent === 'high' ? 'good' : b.intent === 'medium' ? 'warn' : ''}`}>Buying intent: {b.intent}</span>
                        {b.suggested_stage !== lead.stage && !isClosed(lead.stage) && (
                          <button className="btn btn-sm btn-ghost chip-btn" disabled={!!busy} onClick={() => patch({ stage: b.suggested_stage }, `Moved to ${stageLabel(b.suggested_stage)}`)}>
                            Move to {stageLabel(b.suggested_stage)}
                          </button>
                        )}
                      </div>
                      <dl className="kv">
                        <dt>Next step</dt><dd>{b.next_action}</dd>
                        <dt>Follow up</dt><dd>{b.best_follow_up}</dd>
                      </dl>
                      {b.talking_points.length > 0 && <><strong className="tiny">Talking points</strong><ul>{b.talking_points.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
                      {b.objections.length > 0 && <><strong className="tiny">Objections raised</strong><ul>{b.objections.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
                    </div>
                  )}
                </section>

                <details>
                  <summary className="section-title" style={{ cursor: 'pointer' }}>Why score {lead.score}?</summary>
                  <ul className="tiny" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{lead.score_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                </details>

                <form key={formKey} className="stack" style={{ gap: 12 }} onSubmit={saveDetails}>
                  <div className="section-title" style={{ margin: 0 }}>Details</div>
                  <div className="grid-2">
                    <label className="field"><span>Name</span><input name="name" defaultValue={lead.name} maxLength={120} /></label>
                    <label className="field"><span>Company</span><input name="company" defaultValue={lead.company ?? ''} maxLength={160} /></label>
                    <label className="field"><span>Email</span><input name="email" type="email" defaultValue={lead.email ?? ''} /></label>
                    <label className="field"><span>Deal value ($)</span><input name="value" type="number" min={0} step="any" defaultValue={lead.value ?? ''} /></label>
                  </div>
                  <label className="field"><span>Tags</span><input name="tags" defaultValue={lead.tags.join(', ')} placeholder="vip, villa, budget-2m" /><small>Comma-separated.</small></label>
                  <div><button className="btn btn-sm" type="submit" disabled={!!busy}>Save details</button></div>
                </form>

                <section>
                  <div className="section-title">Notes</div>
                  <form className="stack" style={{ gap: 8 }} onSubmit={(e) => {
                    e.preventDefault();
                    if (!note.trim()) return;
                    run('note', async () => {
                      await api(leadUrl(lead.phone, '/notes'), { method: 'POST', body: { text: note } });
                      setNote('');
                      return api<LeadDetail>(leadUrl(lead.phone));
                    });
                  }}>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened, what they want, what you promised…" style={{ minHeight: 70 }} maxLength={4000} />
                    <div><button className="btn btn-sm" type="submit" disabled={!!busy || !note.trim()}>{busy === 'note' ? 'Saving…' : 'Add note'}</button></div>
                  </form>
                  <div className="notes">
                    {lead.notes.map((n) => (
                      <div key={n.id} className="note">
                        <small className="muted">{fmt.date(n.at)}</small>
                        <button className="link-btn" aria-label="Delete note" onClick={() => run('note', async () => {
                          await api(`${leadUrl(lead.phone, '/notes')}?id=${encodeURIComponent(n.id)}`, { method: 'DELETE' });
                          return api<LeadDetail>(leadUrl(lead.phone));
                        })}>Delete</button>
                        <p>{n.text}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="section-title">Call history</div>
                  {lead.history.length ? (
                    <div className="timeline">
                      {lead.history.map((c) => (
                        <button key={c.id} className="timeline-item" onClick={() => { openLead(null); openCall(c.id); }}>
                          <div className="row" style={{ gap: 8 }}>
                            <strong className="tiny">{fmt.date(c.start)}</strong>
                            <span className="tiny muted">{isInbound(c) ? 'Inbound' : 'Outbound'} · {c.agent_name || 'Agent'} · {c.duration_ms ? fmt.dur(c.duration_ms) : endedBecause(c)}</span>
                            <span className="spacer" />
                            <StatusBadge call={c} /> <SentimentBadge sentiment={c.sentiment} />
                          </div>
                          {c.summary && <p>{c.summary}</p>}
                        </button>
                      ))}
                    </div>
                  ) : <p className="muted" style={{ margin: 0 }}>No calls in the last 180 days.</p>}
                </section>

                <div className="row">
                  <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => patch({ archived: !lead.archived }, lead.archived ? 'Lead restored' : 'Lead archived')}>
                    {lead.archived ? 'Restore lead' : 'Archive lead'}
                  </button>
                  <span className="spacer" />
                  <span className="tiny muted">Added {fmt.date(lead.created_at)}</span>
                </div>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
