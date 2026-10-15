'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDashboard } from '@/components/voice/dashboard-context';
import { FollowUp, NextAction, ScoreBadge, StageBadge } from '@/components/voice/leads-ui';
import { api, csvCell, detectPhoneColumn, downloadText, fmt, normalizePhone, parseCsv } from '@/lib/voice/calls';
import { isClosed, STAGES, stageLabel } from '@/lib/voice/leads';
import type { Lead, LeadStage } from '@/lib/voice/types';

const PER_PAGE = 50;
type View = 'queue' | 'board';

function readView(): View {
  try { return localStorage.getItem('dm_leads_view') === 'board' ? 'board' : 'queue'; } catch { return 'queue'; }
}
function readCc() {
  try { return localStorage.getItem('dm_cc') || '971'; } catch { return '971'; }
}

/** End of the day containing `t` (taken from the server response, so render stays pure). */
const endOfDay = (t: number) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return +d; };

export default function LeadsPage() {
  const { leadsVersion, bumpLeads, openLead, toast, setCampaignPrefill } = useDashboard();
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState('');
  const [archived, setArchived] = useState(false);
  const [view, setViewState] = useState<View>('queue');
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [temp, setTemp] = useState('');
  const [source, setSource] = useState('');
  const [due, setDue] = useState(false);
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => api<{ leads: Lead[]; generated_at: number }>(`/api/voice/leads${archived ? '?archived=1' : ''}`)
    .then((r) => { setLeads(r.leads); setNow(r.generated_at); setError(''); })
    .catch((e) => setError(e.message)), [archived]);

  // Restore the saved view after hydration so server and client render the same first frame.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setViewState(readView()); }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(t);
  }, [load, leadsVersion]);

  function setView(v: View) {
    setViewState(v);
    try { localStorage.setItem('dm_leads_view', v); } catch { /* storage unavailable */ }
  }

  const sources = useMemo(() => [...new Set((leads ?? []).map((l) => l.source))].sort(), [leads]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const today = endOfDay(now);
    return (leads ?? []).filter((l) => {
      if (stage === 'open' ? isClosed(l.stage) : stage && l.stage !== stage) return false;
      if (temp && (isClosed(l.stage) || l.temperature !== temp)) return false;
      if (source && l.source !== source) return false;
      if (due && !(l.follow_up_at && l.follow_up_at <= today)) return false;
      if (needle && ![l.name, l.phone, l.email, l.company, l.source, l.last_summary, ...l.tags].join(' ').toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [leads, q, stage, temp, source, due, now]);

  const stats = useMemo(() => {
    const all = leads ?? [];
    const open = all.filter((l) => !isClosed(l.stage));
    const won = all.filter((l) => l.stage === 'won');
    const lost = all.filter((l) => l.stage === 'lost');
    const today = endOfDay(now);
    return {
      open: open.length,
      hot: open.filter((l) => l.temperature === 'hot').length,
      due: open.filter((l) => l.follow_up_at && l.follow_up_at <= today).length,
      overdue: open.filter((l) => l.follow_up_at && l.follow_up_at <= now).length,
      urgent: open.filter((l) => l.next_action.urgency === 'high').length,
      pipeline: open.reduce((s, l) => s + (l.value ?? 0), 0),
      won: won.length,
      wonValue: won.reduce((s, l) => s + (l.value ?? 0), 0),
      winRate: won.length + lost.length ? won.length / (won.length + lost.length) : NaN,
      uncontacted: open.filter((l) => l.stage === 'new').length,
    };
  }, [leads, now]);

  // Optimistic stage change from the board.
  async function moveStage(phone: string, to: LeadStage) {
    const before = leads;
    setLeads((ls) => ls && ls.map((l) => (l.phone === phone ? { ...l, stage: to, stage_manual: true } : l)));
    try {
      await api(`/api/voice/leads/${encodeURIComponent(phone)}`, { method: 'PATCH', body: { stage: to } });
      toast(`Moved to ${stageLabel(to)}`);
      bumpLeads();
    } catch (e) {
      setLeads(before);
      toast((e as Error).message, true);
    }
  }

  async function importFile(f?: File | null) {
    if (!f) return;
    const parsed = parseCsv(await f.text());
    if (parsed.length < 2) { toast('The file needs a header row and at least one lead.', true); return; }
    const hs = parsed[0].map((h) => h.trim().toLowerCase());
    const col = (re: RegExp) => hs.findIndex((h) => re.test(h));
    const pc = detectPhoneColumn(hs);
    const nc = col(/^(full_?name|name|customer_?name|contact_?name|first_?name)$/);
    const ec = col(/e-?mail/);
    const cc = col(/company|business|organi[sz]ation/);
    const vc = col(/value|amount|budget|deal/);
    const tc = col(/^tags?$/);
    const code = readCc();
    const items = parsed.slice(1).map((r) => {
      const v = Number(String(r[vc] ?? '').replace(/[^\d.]/g, ''));
      return {
        phone: normalizePhone(r[pc], code),
        ...(nc >= 0 && r[nc]?.trim() ? { name: r[nc].trim() } : {}),
        ...(ec >= 0 && /\S+@\S+\.\S+/.test(r[ec] ?? '') ? { email: r[ec].trim() } : {}),
        ...(cc >= 0 && r[cc]?.trim() ? { company: r[cc].trim() } : {}),
        ...(vc >= 0 && v > 0 ? { value: v } : {}),
        ...(tc >= 0 && r[tc]?.trim() ? { tags: r[tc].split(/[;|,]/).map((t) => t.trim()).filter(Boolean) } : {}),
      };
    });
    try {
      let created = 0, updated = 0, skipped = 0;
      for (let i = 0; i < items.length; i += 5000) {
        const res = await api<{ created: number; updated: number; skipped: number }>('/api/voice/leads', {
          method: 'POST', body: { leads: items.slice(i, i + 5000), source: `Import: ${f.name}`.slice(0, 120) },
        });
        created += res.created; updated += res.updated; skipped += res.skipped;
      }
      toast(`Imported ${created} new lead${created === 1 ? '' : 's'}${updated ? `, updated ${updated}` : ''}${skipped ? `, skipped ${skipped} invalid` : ''}.`);
      bumpLeads();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  function exportCsv() {
    const cols = ['phone', 'name', 'email', 'company', 'stage', 'score', 'temperature', 'next_step', 'follow_up_at', 'value', 'tags', 'source', 'calls', 'answered', 'last_contact', 'last_summary'];
    const lines = [cols.join(',')].concat(rows.map((l) => [
      l.phone, l.name, l.email, l.company, stageLabel(l.stage), l.score, l.temperature, l.next_action.text,
      l.follow_up_at ? new Date(l.follow_up_at).toISOString() : '', l.value, l.tags.join('; '), l.source, l.calls, l.answered,
      l.last_contact ? new Date(l.last_contact).toISOString() : '', l.last_summary,
    ].map(csvCell).join(',')));
    downloadText(`leads-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
  }

  function campaign() {
    const list = rows.filter((l) => !isClosed(l.stage) && !l.live);
    if (!list.length) { toast('No open leads in this view to call.', true); return; }
    setCampaignPrefill({
      label: `${list.length} leads from the pipeline`,
      headers: ['phone', 'customer_name', 'company'],
      rows: list.map((l) => [l.phone, l.name, l.company ?? '']),
    });
    router.push('/calls/bulk');
  }

  if (error && !leads) return <div className="result err">{error}</div>;
  if (!leads) {
    return (
      <>
        <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi skeleton" style={{ height: 100 }} />)}</div>
        <div className="card skeleton" style={{ height: 420 }} />
      </>
    );
  }

  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const pg = Math.min(page, pages - 1);
  const slice = rows.slice(pg * PER_PAGE, pg * PER_PAGE + PER_PAGE);
  const money = (v: number) => (v ? `$${fmt.n(v)}` : '—');
  const filtered = q || stage || temp || source || due;

  return (
    <>
      <div className="kpis">
        <button className="kpi hero kpi-btn" onClick={() => { setStage('open'); setTemp(''); setDue(false); setPage(0); }}>
          <div className="kpi-label">Open leads</div>
          <div className="kpi-value">{fmt.n(stats.open)}</div>
          <div className="kpi-sub">{fmt.n(stats.uncontacted)} not called yet</div>
        </button>
        <button className="kpi kpi-btn" onClick={() => { setTemp('hot'); setStage(''); setDue(false); setPage(0); }}>
          <div className="kpi-label">Hot leads</div>
          <div className="kpi-value">{fmt.n(stats.hot)}</div>
          <div className="kpi-sub">{fmt.n(stats.urgent)} need action now</div>
        </button>
        <button className="kpi kpi-btn" onClick={() => { setDue(true); setStage(''); setTemp(''); setPage(0); }}>
          <div className="kpi-label">Follow-ups due today</div>
          <div className="kpi-value">{fmt.n(stats.due)}</div>
          <div className="kpi-sub">{stats.overdue ? <span className="delta-down">{fmt.n(stats.overdue)} overdue</span> : 'nothing overdue'}</div>
        </button>
        <div className="kpi">
          <div className="kpi-label">Pipeline value</div>
          <div className="kpi-value">{money(stats.pipeline)}</div>
          <div className="kpi-sub">{fmt.n(stats.won)} won{stats.wonValue ? ` · ${money(stats.wonValue)}` : ''} · win rate {fmt.pct(stats.winRate)}</div>
        </div>
      </div>

      <div className="card">
        <div className="filters">
          <div className="segmented" role="group" aria-label="View">
            <button className={view === 'queue' ? 'active' : ''} onClick={() => setView('queue')}>Work queue</button>
            <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>Pipeline</button>
          </div>
          <input type="search" placeholder="Search name, number, tag, summary…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          {view === 'queue' && (
            <select value={stage} onChange={(e) => { setStage(e.target.value); setPage(0); }} aria-label="Stage">
              <option value="">All stages</option>
              <option value="open">Open (not won/lost)</option>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
          <select value={temp} onChange={(e) => { setTemp(e.target.value); setPage(0); }} aria-label="Temperature">
            <option value="">Any temperature</option>
            <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
          </select>
          {sources.length > 1 && (
            <select value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }} aria-label="Source">
              <option value="">All sources</option>
              {sources.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
          <label className="toggle tiny"><input type="checkbox" checked={due} onChange={(e) => { setDue(e.target.checked); setPage(0); }} /> Due follow-ups</label>
          {filtered && <button className="btn btn-sm btn-ghost" onClick={() => { setQ(''); setStage(''); setTemp(''); setSource(''); setDue(false); }}>Clear</button>}
          <span className="spacer" />
          <button className="btn btn-sm btn-primary" onClick={() => setAdding((a) => !a)}>+ Add lead</button>
          <label className="btn btn-sm">Import CSV<input type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button className="btn btn-sm" onClick={exportCsv} disabled={!rows.length}>Export</button>
          <button className="btn btn-sm" onClick={campaign} disabled={!rows.length} title="Start a bulk campaign calling the open leads in this view">Call these leads</button>
        </div>

        {adding && <AddLead onDone={(phone) => { setAdding(false); bumpLeads(); if (phone) openLead(phone); }} />}

        {!leads.length ? (
          <div className="empty">
            <strong>{archived ? 'No archived leads' : 'No leads yet'}</strong>
            {archived ? 'Leads you archive show up here.' : 'Every number your agents call or get called by becomes a lead automatically. You can also add leads or import a CSV.'}
          </div>
        ) : view === 'board' ? (
          <Board leads={rows} now={now} onMove={moveStage} onOpen={openLead} />
        ) : rows.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Lead</th><th>Stage</th><th>Score</th><th>Next step</th><th>Follow-up</th><th>Last contact</th><th className="right">Calls</th><th className="right">Value</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {slice.map((l) => (
                    <tr key={l.phone} onClick={() => openLead(l.phone)}>
                      <td>
                        <div className="who">
                          <span>{l.name || l.phone}{l.live && <> <span className="badge live">Live</span></>}</span>
                          <small>{l.name ? l.phone : ''}{l.company ? `${l.name ? ' · ' : ''}${l.company}` : ''}</small>
                        </div>
                      </td>
                      <td><StageBadge stage={l.stage} /></td>
                      <td><ScoreBadge lead={l} /></td>
                      <td><NextAction action={l.next_action} /></td>
                      <td><FollowUp ts={l.follow_up_at} now={now} /></td>
                      <td>{l.last_contact ? fmt.date(l.last_contact) : <span className="muted">Never</span>}</td>
                      <td className="right num">{l.calls ? `${l.answered}/${l.calls}` : '—'}</td>
                      <td className="right num">{l.value ? money(l.value) : '—'}</td>
                      <td className="muted">{l.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="muted">{fmt.n(pg * PER_PAGE + 1)}–{fmt.n(pg * PER_PAGE + slice.length)} of {fmt.n(rows.length)}</span>
              <button className="btn btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>Previous</button>
              <button className="btn btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next</button>
            </div>
          </>
        ) : (
          <div className="empty"><strong>No leads match these filters</strong>Clear a filter to see more.</div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <span className="tiny muted">Leads are built from the last 180 days of calls plus anything you add. Answered/total calls shown per lead.</span>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={() => { setArchived((a) => !a); setLeads(null); setPage(0); }}>{archived ? '← Back to active leads' : 'View archived'}</button>
        </div>
      </div>
    </>
  );
}

function Board({ leads, now, onMove, onOpen }: { leads: Lead[]; now: number; onMove: (phone: string, s: LeadStage) => void; onOpen: (p: string) => void }) {
  const [over, setOver] = useState<LeadStage | null>(null);
  return (
    <div className="board">
      {STAGES.map((s) => {
        const items = leads.filter((l) => l.stage === s.key);
        const value = items.reduce((t, l) => t + (l.value ?? 0), 0);
        return (
          <div
            key={s.key}
            className={`board-col${over === s.key ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(s.key); }}
            onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const phone = e.dataTransfer.getData('text/plain');
              const lead = leads.find((l) => l.phone === phone);
              if (lead && lead.stage !== s.key) onMove(phone, s.key);
            }}
          >
            <div className="board-head">
              <StageBadge stage={s.key} />
              <span className="num tiny muted">{items.length}{value ? ` · $${fmt.n(value)}` : ''}</span>
            </div>
            <div className="board-cards">
              {items.slice(0, 100).map((l) => (
                <button
                  key={l.phone}
                  className="board-card"
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.phone); e.dataTransfer.effectAllowed = 'move'; }}
                  onClick={() => onOpen(l.phone)}
                >
                  <div className="row" style={{ gap: 6, justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <strong className="ellipsis">{l.name || l.phone}</strong>
                    <ScoreBadge lead={l} />
                  </div>
                  {l.name && <small className="mono muted">{l.phone}</small>}
                  <NextAction action={l.next_action} />
                  {l.follow_up_at && <small>Follow-up: <FollowUp ts={l.follow_up_at} now={now} /></small>}
                </button>
              ))}
              {items.length > 100 && <p className="tiny muted" style={{ margin: 4 }}>+{items.length - 100} more. Use the work queue to see all.</p>}
              {!items.length && <p className="tiny muted" style={{ margin: 4 }}>{s.hint}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AddLead({ onDone }: { onDone: (phone?: string) => void }) {
  const { toast } = useDashboard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const f = new FormData(e.currentTarget);
    const phone = normalizePhone(String(f.get('phone') ?? ''), readCc());
    const value = Number(f.get('value') || 0);
    setBusy(true);
    try {
      await api('/api/voice/leads', {
        method: 'POST',
        body: {
          leads: [{
            phone,
            name: String(f.get('name') ?? ''),
            email: String(f.get('email') ?? ''),
            company: String(f.get('company') ?? ''),
            ...(value > 0 ? { value } : {}),
          }],
          source: 'Manual',
        },
      });
      toast('Lead added');
      onDone(phone);
    } catch (ex) {
      setError((ex as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="add-lead" onSubmit={submit} autoComplete="off">
      <label className="field"><span>Phone *</span><input name="phone" type="tel" required placeholder="+971 50 123 4567" autoFocus /></label>
      <label className="field"><span>Name</span><input name="name" maxLength={120} /></label>
      <label className="field"><span>Email</span><input name="email" type="email" /></label>
      <label className="field"><span>Company</span><input name="company" maxLength={160} /></label>
      <label className="field"><span>Deal value ($)</span><input name="value" type="number" min={0} step="any" /></label>
      <div className="row" style={{ alignSelf: 'end' }}>
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add lead'}</button>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => onDone()}>Cancel</button>
      </div>
      {error && <p className="form-error" role="alert" style={{ gridColumn: '1 / -1' }}>{error}</p>}
    </form>
  );
}
