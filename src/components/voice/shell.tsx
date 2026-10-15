'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, contactName, contactNumber, endedBecause, fmt, isAnswered, isInbound } from '@/lib/voice/calls';
import type { CallDetail } from '@/lib/voice/types';
import { NAV } from '@/components/shell/nav';
import { SentimentBadge, StatusBadge } from './calls-ui';
import { useDashboard } from './dashboard-context';
import { LeadDrawer } from './lead-drawer';

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const ICONS = {
  call: 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z',
  close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z',
  refresh: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z',
};
export { Icon, ICONS };

const PAGES = NAV.find((s) => s.module === 'calls')!.items;
/** Pages whose data follows the date range picker. */
const RANGED = new Set(['/calls', '/calls/history']);
const RANGES = [{ d: 1, l: '24h' }, { d: 7, l: '7d' }, { d: 30, l: '30d' }, { d: 90, l: '90d' }, { d: 365, l: '1y' }];

/** Voice module frame: page header, date range, live-call meter, call & lead drawers, toasts. */
export function CallsFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { config, days, setDays, loading, reloadCalls, reloadConfig, toasts, configError, toast } = useDashboard();
  const scroller = useRef<HTMLDivElement>(null);
  const page = PAGES.find((n) => n.href === pathname) ?? PAGES[0];

  useEffect(() => { scroller.current?.scrollTo(0, 0); }, [pathname]);
  useEffect(() => { if (configError) toast(configError, true); }, [configError, toast]);

  const c = config?.concurrency;

  return (
    <div ref={scroller} className="voice scroll-thin h-full overflow-y-auto">
      <header className="topbar">
        <div>
          <h1>{page.label}</h1>
          <p className="muted">{page.hint}</p>
        </div>
        <div className="topbar-actions">
          {c && (
            <div className="live-meter" title="Calls running right now vs. your plan limit">
              <span className="tiny muted">Live calls</span>
              <strong className="num">{c.current_concurrency} / {c.concurrency_limit}</strong>
              <div className="meter"><i style={{ width: `${Math.min(100, (c.current_concurrency / Math.max(1, c.concurrency_limit)) * 100)}%` }} /></div>
            </div>
          )}
          {RANGED.has(pathname) && (
            <div className="segmented" role="group" aria-label="Date range">
              {RANGES.map((r) => (
                <button key={r.d} className={r.d === days ? 'active' : ''} onClick={() => setDays(r.d)}>{r.l}</button>
              ))}
            </div>
          )}
          <button className={`icon-btn${loading ? ' spinning' : ''}`} aria-label="Refresh" onClick={() => { reloadCalls(); reloadConfig(); }}>
            <Icon d={ICONS.refresh} />
          </button>
        </div>
      </header>
      <section className="view" aria-live="polite">{children}</section>

      <CallDrawer />
      <LeadDrawer />
      <Suspense><OpenFromUrl /></Suspense>
      <div className="toast-wrap">
        {toasts.map((t) => <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>{t.msg}</div>)}
      </div>
    </div>
  );
}

/** `?lead=+971…` or `?call=<id>` opens that drawer, so other parts of the app can link straight to it. */
function OpenFromUrl() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { openLead, openCall } = useDashboard();
  useEffect(() => {
    const lead = params.get('lead');
    const call = params.get('call');
    if (!lead && !call) return;
    if (lead) openLead(lead);
    if (call) openCall(call);
    router.replace(pathname, { scroll: false });
  }, [params, openLead, openCall, router, pathname]);
  return null;
}

function CallDrawer() {
  const { openCallId, openCall, setCallPrefill, openLead } = useDashboard();
  const router = useRouter();
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!openCallId) return;
    let cancelled = false;
    // Reset before fetching the newly selected call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCall(null);
    setError('');
    api<CallDetail>(`/api/voice/calls/${encodeURIComponent(openCallId)}`)
      .then((c) => { if (!cancelled) setCall(c); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [openCallId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') openCall(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openCall]);

  const open = !!openCallId;
  const name = call ? contactName(call) : '';
  const custom = Object.entries(call?.analysis?.custom_analysis_data ?? {}).filter(([, v]) => v !== null && v !== '');
  const vars = Object.entries(call?.vars ?? {});

  return (
    <>
      {open && <div className="drawer-backdrop" onClick={() => openCall(null)} />}
      <aside className={`drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="drawer-head">
          <h2>{name || (call && contactNumber(call)) || 'Call details'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={() => openCall(null)}><Icon d={ICONS.close} /></button>
        </div>
        {open && (
          <div className="drawer-body">
            {error && <div className="result err">{error}</div>}
            {!call && !error && <><div className="skeleton" style={{ height: 120 }} /><div className="skeleton" style={{ height: 300 }} /></>}
            {call && (
              <>
                <div className="row">
                  <StatusBadge call={call} /> <SentimentBadge sentiment={call.sentiment} />
                  {call.successful === true && <span className="badge good">Goal achieved</span>}
                  {call.successful === false && isAnswered(call) && <span className="badge">Goal not achieved</span>}
                </div>
                <div className="facts">
                  <div className="fact"><span>Started</span><strong>{fmt.date(call.start)}</strong></div>
                  <div className="fact"><span>Duration</span><strong>{call.duration_ms ? fmt.dur(call.duration_ms) : '—'}</strong></div>
                  <div className="fact"><span>Agent</span><strong>{call.agent_name || '—'}</strong></div>
                  <div className="fact"><span>Ended because</span><strong>{endedBecause(call)}</strong></div>
                  <div className="fact"><span>From → To</span><strong className="mono">{call.from || '—'} → {call.to || '—'}</strong></div>
                  <div className="fact"><span>Cost</span><strong>{fmt.money(call.cost_cents)}</strong></div>
                </div>
                {call.recording_url && (
                  <div><div className="section-title">Recording</div><audio controls preload="none" src={call.recording_url} /></div>
                )}
                {call.summary && <div><div className="section-title">Summary</div><p style={{ margin: 0 }}>{call.summary}</p></div>}
                {custom.length > 0 && (
                  <div><div className="section-title">Extracted data</div>
                    <dl className="kv">{custom.map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}><dt>{k.replace(/_/g, ' ')}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>
                    ))}</dl></div>
                )}
                {vars.length > 0 && (
                  <div><div className="section-title">Call variables</div>
                    <dl className="kv">{vars.map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
                    ))}</dl></div>
                )}
                <div>
                  <div className="section-title">Transcript</div>
                  {call.transcript.length ? (
                    <div className="transcript">
                      {call.transcript.map((t, i) => (
                        <div key={i} className={`bubble ${t.role === 'user' ? 'user' : 'agent'}`}>
                          <small>{t.role === 'user' ? 'Customer' : 'Agent'}{t.at != null ? ` · ${fmt.dur(t.at * 1000)}` : ''}</small>
                          {t.content}
                        </div>
                      ))}
                    </div>
                  ) : <p className="muted" style={{ margin: 0 }}>No conversation was recorded for this call.</p>}
                </div>
                <div className="row">
                  <button className="btn btn-primary" onClick={() => {
                    // On inbound calls the customer is the caller and our number is the callee.
                    setCallPrefill({ to: contactNumber(call), agent_id: call.agent_id, from: isInbound(call) ? call.to : call.from, vars: call.vars ?? {} });
                    openCall(null);
                    router.push('/calls/new');
                  }}>{isInbound(call) ? 'Call back' : 'Call again'}</button>
                  {contactNumber(call) && <button className="btn" onClick={() => { openCall(null); openLead(contactNumber(call)!); }}>Open lead</button>}
                  <span className="tiny muted mono">{call.id}</span>
                </div>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
