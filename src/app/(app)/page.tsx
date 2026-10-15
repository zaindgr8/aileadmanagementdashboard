'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BellRing, Flame, Hand, Loader2, MessageCircle, PhoneCall, RefreshCw, Search, TriangleAlert, Users,
} from 'lucide-react';
import { failed, type CallsSummary, type Channel, type Contact, type Overview, type WhatsAppSummary } from '@/lib/overview';
import { Avatar, ScoreRing } from '@/components/whatsapp/ui';

const nf = new Intl.NumberFormat();
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const mins = (ms: number) => `${nf.format(Math.round(ms / 60000))} min`;

function ago(ts: number) {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const STAGE_LABEL: Record<string, string> = {
  new: 'New', qualified: 'Qualified', hot: 'Hot', won: 'Won', lost: 'Lost', attempted: 'Attempted', engaged: 'Engaged',
  proposal: 'Proposal', booking_link_sent: 'Booking link sent', member: 'Member', handoff: 'Handoff', opted_out: 'Opted out',
};
const label = (s?: string) => (s ? STAGE_LABEL[s] ?? s.replace(/_/g, ' ') : '');

type Filter = 'all' | 'both' | Channel;

export default function Home() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/overview');
      if (res.status === 401) { window.location.href = '/login'; return; }
      setData(await res.json());
      setError('');
    } catch {
      setError('Could not load the overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    fetch('/api/me').then((r) => r.json()).then((u) => setName(u.name ?? '')).catch(() => {});
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const contacts = useMemo(() => {
    const s = q.toLowerCase().trim();
    return (data?.contacts ?? []).filter((c) => {
      if (filter === 'both' && c.channels.length < 2) return false;
      if ((filter === 'whatsapp' || filter === 'calls') && !c.channels.includes(filter)) return false;
      return !s || `${c.name} ${c.phone} ${c.summary ?? ''}`.toLowerCase().includes(s);
    });
  }, [data, filter, q]);

  const both = data?.contacts.filter((c) => c.channels.length > 1).length ?? 0;
  const wa = data?.whatsapp;
  const calls = data?.calls;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-7 flex flex-wrap items-end gap-4">
          <div>
            <p className="text-sm font-medium text-brand">{greeting()}{name ? `, ${name}` : ''}</p>
            <h1 className="font-display text-[28px] font-semibold leading-tight">Your leads, every channel</h1>
            <p className="mt-1 text-sm text-ink-2">WhatsApp conversations and AI voice calls in one pipeline.</p>
          </div>
          <button onClick={load} disabled={loading} className="btn ml-auto"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        </div>

        {error && <div className="mb-6 rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</div>}

        {!data ? <Skeleton /> : (
          <>
            {/* Headline numbers */}
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile hero label="Contacts" value={nf.format(data.contacts.length)} sub={`${both} reached on both channels`} icon={Users} />
              <Tile label="Need attention" value={nf.format(data.attention.length)} sub="handoffs & urgent follow-ups" icon={BellRing} warn={data.attention.length > 0} />
              <Tile label="Hot leads"
                value={nf.format((wa && !failed(wa) ? wa.stages.hot : 0) + (calls && !failed(calls) ? calls.hot : 0))}
                sub={`${wa && !failed(wa) ? wa.stages.hot : 0} WhatsApp · ${calls && !failed(calls) ? calls.hot : 0} calls`} icon={Flame} />
              <Tile label="Won"
                value={nf.format((wa && !failed(wa) ? wa.stages.won : 0) + (calls && !failed(calls) ? calls.won : 0))}
                sub="closed across channels" icon={ArrowRight} />
            </div>

            {/* Channel cards */}
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              {data.whatsapp && <WhatsAppCard s={data.whatsapp} />}
              {data.calls && <CallsCard s={data.calls} />}
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
              {/* Unified contacts */}
              <section className="card min-w-0 overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
                  <div>
                    <h2 className="font-display font-semibold">All contacts</h2>
                    <p className="text-xs text-ink-3">Matched by phone number across WhatsApp and calls</p>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <label className="relative">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="input h-8 w-40 py-1 pl-8 text-[13px]" />
                    </label>
                    <div className="flex rounded-lg border border-line bg-panel-2 p-0.5 text-xs font-medium">
                      {([['all', 'All'], ['both', 'Both'], ['whatsapp', 'WhatsApp'], ['calls', 'Calls']] as const).map(([k, l]) => (
                        <button key={k} onClick={() => setFilter(k)}
                          className={`rounded-md px-2.5 py-1 transition ${filter === k ? 'bg-panel text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>{l}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="scroll-thin max-h-[560px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-[1] bg-panel-2 text-left text-xs text-ink-3">
                      <tr>
                        <th className="px-5 py-2.5 font-medium">Contact</th>
                        <th className="px-3 py-2.5 font-medium">Channels</th>
                        <th className="hidden px-3 py-2.5 font-medium md:table-cell">Stage</th>
                        <th className="px-3 py-2.5 font-medium">Score</th>
                        <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Last touch</th>
                        <th className="px-5 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.slice(0, 200).map((c) => <ContactRow key={c.phone} c={c} />)}
                    </tbody>
                  </table>
                  {!contacts.length && <p className="px-5 py-12 text-center text-sm text-ink-3">{data.contacts.length ? 'No contacts match.' : 'No contacts yet. They appear here as soon as someone messages you or gets a call.'}</p>}
                </div>
              </section>

              {/* Needs attention */}
              <section className="card h-fit p-5">
                <h2 className="mb-1 flex items-center gap-2 font-display font-semibold"><BellRing size={16} className="text-brand" /> Needs attention</h2>
                <p className="mb-3 text-xs text-ink-3">Chats waiting for a human and leads you should call now</p>
                <ul className="space-y-1">
                  {data.attention.slice(0, 14).map((a, i) => (
                    <li key={a.kind + a.phone + i}>
                      <Link href={a.href} className="flex items-start gap-3 rounded-xl px-2 py-2 transition hover:bg-panel-2">
                        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${a.kind === 'whatsapp' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand'}`}>
                          {a.kind === 'whatsapp' ? <Hand size={14} /> : <PhoneCall size={14} />}
                        </span>
                        <span className="min-w-0 text-[13px]">
                          <span className="block truncate font-medium">{a.name}</span>
                          <span className="line-clamp-2 text-ink-2">{a.text}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                  {!data.attention.length && <li className="rounded-xl bg-ok-soft px-3 py-4 text-center text-sm text-ok">All caught up.</li>}
                </ul>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, icon: Icon, warn, hero }: { label: string; value: string; sub: string; icon: React.ComponentType<{ size?: number }>; warn?: boolean; hero?: boolean }) {
  return (
    <div className={`card relative overflow-hidden p-4 ${hero ? 'border-transparent text-white' : ''}`}
      style={hero ? { background: 'linear-gradient(135deg, var(--brand) 0%, #7f1514 100%)' } : undefined}>
      <div className={`flex items-center gap-2 text-xs font-medium ${hero ? 'text-white/80' : 'text-ink-2'}`}><Icon size={14} />{label}</div>
      <div className={`mt-1 font-display text-[26px] font-semibold tabular-nums ${warn ? 'text-warn' : ''}`}>{value}</div>
      <div className={`mt-0.5 text-xs ${hero ? 'text-white/75' : 'text-ink-3'}`}>{sub}</div>
    </div>
  );
}

function ChannelCard({ title, icon: Icon, href, cta, error, children }: {
  title: string; icon: React.ComponentType<{ size?: number }>; href: string; cta: string; error?: string; children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand"><Icon size={18} /></span>
        <h2 className="font-display text-[17px] font-semibold">{title}</h2>
        <Link href={href} className="btn ml-auto px-3 py-1.5 text-[13px]">{cta} <ArrowRight size={14} /></Link>
      </div>
      {error ? (
        <div className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-3 text-[13px] text-warn"><TriangleAlert size={15} className="mt-0.5 shrink-0" /><span>Couldn&apos;t load this channel: {error}</span></div>
      ) : children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl bg-panel-2 px-3 py-2.5">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className={`font-display text-lg font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

function WhatsAppCard({ s }: { s: WhatsAppSummary | { error: string } }) {
  if (failed(s)) return <ChannelCard title="WhatsApp" icon={MessageCircle} href="/whatsapp" cta="Open inbox" error={s.error}>{null}</ChannelCard>;
  const total = Object.values(s.stages).reduce((a, b) => a + b, 0) || 1;
  const bars = [
    { k: 'new', l: 'New', c: 'var(--ink-3)' }, { k: 'qualified', l: 'Qualified', c: 'var(--info)' },
    { k: 'hot', l: 'Hot', c: 'var(--brand)' }, { k: 'won', l: 'Won', c: 'var(--ok)' }, { k: 'lost', l: 'Lost', c: 'var(--neutral)' },
  ] as const;
  return (
    <ChannelCard title="WhatsApp" icon={MessageCircle} href="/whatsapp" cta="Open inbox">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Conversations" value={nf.format(s.conversations)} />
        <Stat label="Active this week" value={nf.format(s.activeWeek)} />
        <Stat label="Unread" value={nf.format(s.unread)} tone={s.unread ? 'text-brand' : ''} />
        <Stat label="Need a human" value={nf.format(s.needsHuman)} tone={s.needsHuman ? 'text-warn' : ''} />
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs text-ink-3"><span>Lead stages</span><span>avg score {s.avgScore ?? '—'}</span></div>
        <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-panel-2">
          {bars.map((b) => s.stages[b.k] > 0 && <span key={b.k} style={{ width: `${(s.stages[b.k] / total) * 100}%`, background: b.c }} title={`${b.l}: ${s.stages[b.k]}`} />)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {bars.map((b) => <span key={b.k} className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm" style={{ background: b.c }} />{b.l} <b className="tabular-nums">{s.stages[b.k]}</b></span>)}
        </div>
      </div>
    </ChannelCard>
  );
}

function CallsCard({ s }: { s: CallsSummary | { error: string } }) {
  if (failed(s)) return <ChannelCard title="Voice calls" icon={PhoneCall} href="/calls" cta="Open calls" error={s.error}>{null}</ChannelCard>;
  return (
    <ChannelCard title="Voice calls" icon={PhoneCall} href="/calls" cta="Open calls">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Calls (30d)" value={nf.format(s.calls30d)} />
        <Stat label="Answer rate" value={pct(s.answerRate)} />
        <Stat label="Talk time" value={mins(s.talkMs)} />
        <Stat label="Live now" value={s.live} tone={s.live ? 'text-brand' : ''} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Link href="/calls/leads" className="rounded-xl border border-line px-3 py-2.5 transition hover:bg-panel-2">
          <div className="font-display text-lg font-semibold tabular-nums">{nf.format(s.leads)}</div><div className="text-[11.5px] text-ink-3">Call leads</div>
        </Link>
        <Link href="/calls/leads" className="rounded-xl border border-line px-3 py-2.5 transition hover:bg-panel-2">
          <div className="font-display text-lg font-semibold tabular-nums text-brand">{nf.format(s.hot)}</div><div className="text-[11.5px] text-ink-3">Hot</div>
        </Link>
        <Link href="/calls/leads" className="rounded-xl border border-line px-3 py-2.5 transition hover:bg-panel-2">
          <div className={`font-display text-lg font-semibold tabular-nums ${s.followUpsDue ? 'text-warn' : ''}`}>{nf.format(s.followUpsDue)}</div><div className="text-[11.5px] text-ink-3">Follow-ups due</div>
        </Link>
      </div>
    </ChannelCard>
  );
}

function ContactRow({ c }: { c: Contact }) {
  const stages = [c.waStage && `WA: ${label(c.waStage)}`, !c.waStage && c.waProfileStage && `WA: ${label(c.waProfileStage)}`, c.callStage && `Call: ${label(c.callStage)}`].filter(Boolean);
  return (
    <tr className="border-t border-line align-middle hover:bg-panel-2">
      <td className="px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={c.name || c.phone} size={32} />
          <div className="min-w-0">
            <div className="truncate font-medium">{c.name || c.phone}</div>
            <div className="truncate text-xs text-ink-3">{c.name ? c.phone : c.summary ?? ''}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1">
          {c.channels.includes('whatsapp') && <span className="grid h-6 w-6 place-items-center rounded-full bg-ok-soft text-ok" title="WhatsApp"><MessageCircle size={13} /></span>}
          {c.channels.includes('calls') && <span className="grid h-6 w-6 place-items-center rounded-full bg-info-soft text-info" title="Voice calls"><PhoneCall size={13} /></span>}
        </div>
      </td>
      <td className="hidden px-3 py-2.5 text-xs text-ink-2 md:table-cell">{stages.join(' · ') || '—'}</td>
      <td className="px-3 py-2.5">{c.score != null ? <ScoreRing score={c.score} size={30} /> : <span className="text-ink-3">—</span>}</td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-ink-2 sm:table-cell">{ago(c.lastTouch)}</td>
      <td className="px-5 py-2.5">
        <div className="flex justify-end gap-1.5">
          {c.waId && <Link href={`/whatsapp?c=${encodeURIComponent(c.waId)}`} className="btn px-2 py-1 text-xs" title="Open WhatsApp chat"><MessageCircle size={14} /></Link>}
          {c.channels.includes('calls') && <Link href={`/calls/leads?lead=${encodeURIComponent(c.phone)}`} className="btn px-2 py-1 text-xs" title="Open call lead"><PhoneCall size={14} /></Link>}
        </div>
      </td>
    </tr>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[104px]" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><div className="skeleton h-56" /><div className="skeleton h-56" /></div>
      <div className="skeleton h-80" />
      <div className="flex justify-center py-2 text-ink-3"><Loader2 className="animate-spin" size={18} /></div>
    </div>
  );
}
