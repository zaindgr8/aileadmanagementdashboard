'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { NoNumbersCard } from '@/components/voice/calls-ui';
import { useDashboard } from '@/components/voice/dashboard-context';
import { AgentSelect, avgCostPerDial, defaultAgentFor, PhoneSelect, suggestedVars } from '@/components/voice/form-helpers';
import { api, detectPhoneColumn, downloadText, fmt, normalizePhone, parseCsv, validPhone } from '@/lib/voice/calls';
import type { Batch } from '@/lib/voice/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function readCc() {
  try { return localStorage.getItem('dm_cc') || '971'; } catch { return '971'; }
}

const isFuture = (ts: number) => ts > Date.now();
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export default function BulkPage() {
  const { config, calls, prevCalls, toast, campaignPrefill, setCampaignPrefill } = useDashboard();
  const router = useRouter();
  // Contacts sent over from the Leads page, consumed once.
  const [pre] = useState(campaignPrefill);
  useEffect(() => { if (campaignPrefill) setCampaignPrefill(null); }, [campaignPrefill, setCampaignPrefill]);

  const [headers, setHeaders] = useState<string[]>(pre?.headers ?? []);
  const [rows, setRows] = useState<string[][]>(pre?.rows ?? []);
  const [phoneCol, setPhoneCol] = useState(0);
  const [fileName, setFileName] = useState(pre?.label ?? '');
  const [paste, setPaste] = useState('');
  const [cc, setCc] = useState(readCc);
  const [over, setOver] = useState(false);

  const [name, setName] = useState('');
  const [fromState, setFrom] = useState('');
  const [agentState, setAgent] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [useWindow, setUseWindow] = useState(false);
  const [wStart, setWStart] = useState('09:00');
  const [wEnd, setWEnd] = useState('19:00');
  const [tz, setTz] = useState('Asia/Dubai');
  const [days, setDays] = useState(DAYS.filter((d) => d !== 'Sunday'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const contacts = useMemo(() => {
    const seen = new Set<string>();
    return rows.map((r) => {
      const phone = normalizePhone(r[phoneCol], cc);
      const variables: Record<string, string> = {};
      headers.forEach((h, i) => { if (i !== phoneCol && h && r[i]?.trim()) variables[h.trim()] = r[i].trim(); });
      const status = !validPhone(phone) ? 'invalid' : seen.has(phone) ? 'duplicate' : 'ok';
      seen.add(phone);
      return { phone, raw: r[phoneCol] ?? '', variables, status };
    });
  }, [rows, headers, phoneCol, cc]);

  const zones = useMemo(() => [...new Set(['Asia/Dubai', Intl.DateTimeFormat().resolvedOptions().timeZone, 'Asia/Riyadh', 'Asia/Karachi', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'])], []);

  if (!config) return <div className="card skeleton" style={{ height: 420 }} />;
  if (!config.phoneNumbers.length) return <NoNumbersCard />;

  const from = config.phoneNumbers.some((p) => p.phone_number === fromState) ? fromState : config.phoneNumbers[0].phone_number;
  const agent = config.agents.some((a) => a.agent_id === agentState) ? agentState : defaultAgentFor(config, from) ?? config.agents[0]?.agent_id ?? '';
  const ready = contacts.filter((c) => c.status === 'ok');
  const invalid = contacts.filter((c) => c.status === 'invalid').length;
  const dupes = contacts.filter((c) => c.status === 'duplicate').length;
  const varCols = headers.filter((_, i) => i !== phoneCol);
  const avg = avgCostPerDial(calls.concat(prevCalls), agent);
  const limit = config.concurrency?.concurrency_limit;
  const agentName = config.agents.find((a) => a.agent_id === agent)?.agent_name;

  function load(text: string, label: string) {
    const parsed = parseCsv(text);
    if (parsed.length < 2) { toast('The file needs a header row and at least one contact.', true); return; }
    const hs = parsed[0].map((h) => h.trim());
    setHeaders(hs);
    setRows(parsed.slice(1));
    setPhoneCol(detectPhoneColumn(hs));
    setFileName(label);
  }

  async function loadFile(f?: File | null) {
    if (f) load(await f.text(), f.name);
  }

  function template() {
    const keys = suggestedVars(calls.concat(prevCalls), agent).filter((k) => !/phone|number|contact/i.test(k));
    const cols = ['phone', ...(keys.length ? keys : ['customer_name'])];
    downloadText('contacts-template.csv', `${cols.join(',')}\n+971501234567,${cols.slice(1).map(() => '').join(',')}\n`);
  }

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!ready.length) return;
    let window: { start: number; end: number; timezone: string; days: string[] } | undefined;
    if (useWindow) {
      window = { start: toMin(wStart), end: toMin(wEnd) || 1440, timezone: tz, days };
      if (window.start >= window.end) { setError('Calling hours must start before they end (overnight windows are not supported).'); return; }
      if (!days.length) { setError('Pick at least one calling day.'); return; }
    }
    let trigger: number | undefined;
    if (when === 'later') {
      trigger = new Date(at).getTime();
      if (!isFuture(trigger)) { setError('Pick a start time in the future.'); return; }
    }
    if (!confirm(`Start "${name}" and call ${ready.length} contact${ready.length === 1 ? '' : 's'}?`)) return;
    setBusy(true);
    try {
      const res = await api<Batch>('/api/voice/batches', {
        method: 'POST',
        body: { name, from_number: from, agent_id: agent, trigger_timestamp: trigger, window, tasks: ready.map((c) => ({ to_number: c.phone, variables: c.variables })) },
      });
      toast(`Campaign "${res.name}" launched with ${res.total} calls.`);
      router.push('/calls/campaigns');
    } catch (ex) {
      setError((ex as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="form-layout">
      <div className="stack">
        <div className="card stack">
          <div className="card-head" style={{ margin: 0 }}>
            <h2>1 · Contacts</h2><span className="spacer" />
            <button className="btn btn-sm" type="button" onClick={template}>Download template</button>
          </div>
          <label
            className={`dropzone${over ? ' over' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); loadFile(e.dataTransfer.files[0]); }}
          >
            <input type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
            <strong>{fileName || 'Drop a CSV file here or click to browse'}</strong>
            <span className="muted">One row per person. A phone column is required; every other column becomes a call variable.</span>
          </label>
          <details>
            <summary className="muted" style={{ cursor: 'pointer' }}>…or paste contacts</summary>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'phone,customer_name\n+971501234567,Sara\n+971551112233,Omar'} style={{ marginTop: 8 }} />
            <button className="btn btn-sm" type="button" style={{ marginTop: 8 }} onClick={() => load(paste, 'Pasted contacts')}>Use pasted contacts</button>
          </details>
          <div className="grid-2">
            <label className="field"><span>Phone column</span>
              <select value={phoneCol} onChange={(e) => setPhoneCol(Number(e.target.value))} disabled={!headers.length}>
                {headers.length ? headers.map((h, i) => <option key={i} value={i}>{h}</option>) : <option>—</option>}
              </select>
            </label>
            <label className="field"><span>Default country code</span>
              <input inputMode="numeric" placeholder="971" value={cc} onChange={(e) => { setCc(e.target.value); try { localStorage.setItem('dm_cc', e.target.value); } catch { /* storage unavailable */ } }} />
              <small>Used for numbers written without a + prefix.</small>
            </label>
          </div>

          {contacts.length > 0 && (
            <div>
              <div className="row">
                <span className="badge good">{fmt.n(ready.length)} ready</span>
                {invalid > 0 && <span className="badge bad">{invalid} invalid</span>}
                {dupes > 0 && <span className="badge warn">{dupes} duplicates</span>}
                <span className="muted tiny">Variables: {varCols.length ? varCols.map((v) => <span key={v} className="chip mono">{v}</span>) : 'none'}</span>
              </div>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>Phone</th>{varCols.map((v) => <th key={v}>{v}</th>)}<th /></tr></thead>
                  <tbody>
                    {contacts.slice(0, 8).map((c, i) => (
                      <tr key={i} className="static">
                        <td className="mono">{c.status === 'invalid' ? c.raw : c.phone}</td>
                        {varCols.map((v) => <td key={v}>{c.variables[v.trim()] ?? ''}</td>)}
                        <td>{c.status !== 'ok' && <span className={`badge ${c.status === 'invalid' ? 'bad' : 'warn'}`}>{c.status}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {contacts.length > 8 && <p className="tiny muted" style={{ margin: '8px 0 0' }}>Showing 8 of {fmt.n(contacts.length)} rows.</p>}
            </div>
          )}
        </div>
      </div>

      <form className="stack" onSubmit={launch} autoComplete="off">
        <div className="card stack">
          <div className="card-head" style={{ margin: 0 }}><h2>2 · Campaign settings</h2></div>
          <label className="field"><span>Campaign name</span>
            <input required placeholder="e.g. October open-house follow-ups" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="grid-2">
            <label className="field"><span>AI agent</span><AgentSelect config={config} phone={from} value={agent} onChange={setAgent} /></label>
            <label className="field"><span>Caller ID</span><PhoneSelect config={config} value={from} onChange={setFrom} /></label>
          </div>
          <div className="field"><span>When to start</span>
            <div className="row">
              <label className="toggle"><input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} /> Right away</label>
              <label className="toggle"><input type="radio" name="when" checked={when === 'later'} onChange={() => setWhen('later')} /> Schedule</label>
            </div>
            {when === 'later' && <input type="datetime-local" value={at} required onChange={(e) => setAt(e.target.value)} />}
          </div>
          <div className="field">
            <label className="toggle"><input type="checkbox" checked={useWindow} onChange={(e) => setUseWindow(e.target.checked)} /> Only call during set hours</label>
            {useWindow && (
              <div className="stack" style={{ gap: 10 }}>
                <div className="grid-2">
                  <label className="field"><span>From</span><input type="time" value={wStart} onChange={(e) => setWStart(e.target.value)} /></label>
                  <label className="field"><span>Until</span><input type="time" value={wEnd} onChange={(e) => setWEnd(e.target.value)} /></label>
                </div>
                <label className="field"><span>Recipients&apos; time zone</span>
                  <select value={tz} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</select>
                </label>
                <div className="days">
                  {DAYS.map((d) => (
                    <label key={d}>
                      <input type="checkbox" checked={days.includes(d)} onChange={(e) => setDays(e.target.checked ? DAYS.filter((x) => x === d || days.includes(x)) : days.filter((x) => x !== d))} />
                      {d.slice(0, 3)}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card stack">
          <div className="card-head" style={{ margin: 0 }}><h2>3 · Review & launch</h2></div>
          <div className="summary-box">
            <div className="summary-line"><span>Contacts to call</span><strong className="num">{fmt.n(ready.length)}</strong></div>
            <div className="summary-line"><span>Agent</span><strong>{agentName ?? '—'}</strong></div>
            <div className="summary-line"><span>Starts</span><strong>{when === 'later' && at ? new Date(at).toLocaleString() : 'Immediately'}</strong></div>
            {useWindow && <div className="summary-line"><span>Calling hours</span><strong>{wStart}–{wEnd} {tz}</strong></div>}
            {limit && <div className="summary-line"><span>Runs up to</span><strong>{limit} calls at once</strong></div>}
            {avg != null && ready.length > 0 && (
              <>
                <div className="summary-line"><span>Estimated cost</span><strong>≈ {fmt.money(avg * ready.length)}</strong></div>
                <p className="tiny muted" style={{ margin: 0 }}>Based on this agent&apos;s recent average of {fmt.money(avg)} per dial.</p>
              </>
            )}
          </div>
          <p className="form-error" role="alert">{error}</p>
          <button className="btn btn-primary" type="submit" disabled={busy || !ready.length || !agent}>
            {busy ? 'Launching…' : ready.length ? `Launch campaign · ${fmt.n(ready.length)} calls` : 'Add contacts to launch'}
          </button>
        </div>
      </form>
    </div>
  );
}
