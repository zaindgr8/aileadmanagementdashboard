'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CallsTable, NoNumbersCard, SentimentBadge, StatusBadge } from '@/components/voice/calls-ui';
import { useDashboard } from '@/components/voice/dashboard-context';
import { AgentSelect, defaultAgentFor, PhoneSelect, suggestedVars } from '@/components/voice/form-helpers';
import { Icon, ICONS } from '@/components/voice/shell';
import { api, fmt, isLive, normalizePhone, validPhone } from '@/lib/voice/calls';
import type { CallDetail } from '@/lib/voice/types';

interface VarRow { id: number; k: string; v: string }
let rowId = 0;
const toRows = (entries: [string, string][]) => entries.map(([k, v]) => ({ id: ++rowId, k, v }));

export default function NewCallPage() {
  const { config, calls, prevCalls, callPrefill, setCallPrefill, toast, reloadCalls } = useDashboard();
  // Consume a "Call again" prefill exactly once.
  const [pre] = useState(callPrefill);
  useEffect(() => { if (callPrefill) setCallPrefill(null); }, [callPrefill, setCallPrefill]);

  const [to, setTo] = useState(pre?.to ?? '');
  const [fromState, setFrom] = useState(pre?.from ?? '');
  const [agentState, setAgent] = useState(pre?.agent_id ?? '');
  const [rows, setRows] = useState<VarRow[] | null>(() => (pre?.vars && Object.keys(pre.vars).length ? toRows(Object.entries(pre.vars)) : null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tracked, setTracked] = useState<{ id: string; to: string } | null>(null);

  if (!config) return <div className="card skeleton" style={{ height: 420 }} />;
  if (!config.phoneNumbers.length) return <NoNumbersCard />;

  const from = config.phoneNumbers.some((p) => p.phone_number === fromState) ? fromState : config.phoneNumbers[0].phone_number;
  const agent = config.agents.some((a) => a.agent_id === agentState)
    ? agentState
    : defaultAgentFor(config, from) ?? config.agents[0]?.agent_id ?? '';
  // Until the user edits variables, show the ones this agent has used before.
  const suggested = suggestedVars(calls.concat(prevCalls), agent);
  const shownRows = rows ?? (suggested.length ? suggested : ['customer_name']).map((k, i) => ({ id: -1 - i, k, v: '' }));
  const edit = (next: VarRow[]) => setRows(next);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const number = normalizePhone(to);
    if (!validPhone(number)) { setError('Enter the number in international format, e.g. +971501234567.'); return; }
    const variables = Object.fromEntries(shownRows.map((r) => [r.k.trim(), r.v.trim()]).filter(([k, v]) => k && v));
    setBusy(true);
    try {
      const res = await api<{ call_id: string }>('/api/voice/calls', { method: 'POST', body: { to_number: number, from_number: from, agent_id: agent, variables } });
      toast(`Calling ${number}…`);
      setTracked({ id: res.call_id, to: number });
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-layout">
      <form className="card stack" onSubmit={submit} autoComplete="off">
        <div className="card-head" style={{ margin: 0 }}><h2>Call details</h2></div>
        <label className="field">
          <span>Phone number to call</span>
          <input type="tel" required placeholder="+971 50 123 4567" value={to} onChange={(e) => setTo(e.target.value)} />
          <small>International format with country code.</small>
        </label>
        <div className="grid-2">
          <label className="field"><span>AI agent</span><AgentSelect config={config} phone={from} value={agent} onChange={(v) => { setAgent(v); if (rows?.every((r) => !r.v.trim())) setRows(null); }} /></label>
          <label className="field"><span>Caller ID</span><PhoneSelect config={config} value={from} onChange={setFrom} /></label>
        </div>
        <div className="field">
          <span>Call variables</span>
          <small>Personalise the call. These fill <span className="mono">{'{{placeholders}}'}</span> in your agent&apos;s script.</small>
          <div className="vars">
            {shownRows.map((r, i) => (
              <div className="var-row" key={r.id}>
                <input placeholder="name" aria-label="Variable name" value={r.k} onChange={(e) => edit(shownRows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
                <input placeholder="value" aria-label="Variable value" value={r.v} onChange={(e) => edit(shownRows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
                <button type="button" className="icon-btn" aria-label="Remove variable" onClick={() => edit(shownRows.filter((_, j) => j !== i))}><Icon d={ICONS.close} /></button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={() => edit([...shownRows, ...toRows([['', '']])])}>+ Add variable</button>
        </div>
        <p className="form-error" role="alert">{error}</p>
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={busy || !agent}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d={ICONS.call} /></svg>
            {busy ? 'Starting…' : 'Start call'}
          </button>
        </div>
        {tracked && <CallTracker key={tracked.id} id={tracked.id} to={tracked.to} onDone={() => reloadCalls({ silent: true })} />}
      </form>

      <div className="stack">
        <div className="hint">
          <strong>How it works</strong>
          <ul>
            <li>Your AI agent dials the number immediately from the caller ID you pick.</li>
            <li>Variables like <span className="mono">customer_name</span> let the agent greet people personally.</li>
            <li>When the call ends, the recording, transcript and summary appear in <Link href="/calls/history">Call history</Link>.</li>
          </ul>
        </div>
        <div className="card">
          <div className="card-head"><h2>Recent calls</h2></div>
          <CallsTable calls={calls.slice(0, 5)} compact />
        </div>
      </div>
    </div>
  );
}

function CallTracker({ id, to, onDone }: { id: string; to: string; onDone: () => void }) {
  const { openCall } = useDashboard();
  const [call, setCall] = useState<CallDetail | null>(null);
  // Keep the latest callback without restarting the poll every time the parent re-renders.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  useEffect(() => {
    let stop = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let c: CallDetail | null = null;
      try { c = await api<CallDetail>(`/api/voice/calls/${encodeURIComponent(id)}`); } catch { /* not indexed yet */ }
      if (stop) return;
      if (c) setCall(c);
      if (c && !isLive(c)) { onDoneRef.current(); return; }
      if (++tries < 120) timer = setTimeout(tick, 3000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  const done = call && !isLive(call);
  return (
    <div className="result ok">
      <div className="row">
        <strong>Call to {to}</strong>
        {call ? <StatusBadge call={call} /> : <span className="badge live">Dialling</span>}
        {done && <SentimentBadge sentiment={call.sentiment} />}
        <span className="spacer" />
        {done
          ? <button className="btn btn-sm" type="button" onClick={() => openCall(id)}>View details</button>
          : <span className="tiny">{call?.duration_ms ? fmt.dur(call.duration_ms) : 'Waiting for answer…'}</span>}
      </div>
      {done && call.summary && <p style={{ margin: '8px 0 0', color: 'var(--text-2)' }}>{call.summary}</p>}
    </div>
  );
}
