"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowRight, Download, Hand, MessageCircle, Search, X } from "lucide-react";
import { api, timeAgo, useLive } from "@/lib/whatsapp/client";
import { Avatar, PriorityBadge, ScoreRing } from "@/components/whatsapp/ui";
import type { Priority } from "@/lib/whatsapp/types";

type WaLead = {
  phone: string;
  name: string;
  wa_name: string;
  query: string;
  association: string;
  interest: string;
  business_owner: string;
  stage: string;
  handoff: boolean;
  notes: string;
  last_seen: string | null;
  created_at: string;
  /** AI score of the matching chat. */
  ai: { score: number; priority: Priority | null; intent: string; summary: string; nextStep: string; source: string } | null;
};

// Freya's stages (set by the n8n Profile Updater).
const STAGES: Record<string, { label: string; chip: string }> = {
  new: { label: "New", chip: "bg-panel-2 text-ink-2" },
  engaged: { label: "Engaged", chip: "bg-info-soft text-info" },
  qualified: { label: "Qualified", chip: "bg-brand-soft text-brand" },
  booking_link_sent: { label: "Booking link sent", chip: "bg-ai-soft text-ai" },
  member: { label: "Member", chip: "bg-ok-soft text-ok" },
  handoff: { label: "Handoff", chip: "bg-warn-soft text-warn" },
  opted_out: { label: "Opted out", chip: "bg-danger-soft text-danger" },
};

const LABELS: Record<string, string> = {
  new: "New", free_class: "Free class", website_signup: "Website signup", course_or_resources: "Course / resources",
  aaa_member: "AAA member", event_attendee: "Event attendee", founder_call: "Founder call",
  general_info: "General info", aaa: "AAA", event: "Event", founder_meeting: "Founder meeting", business_ai: "Business AI", other: "Other",
};
const codes = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
const leadName = (l: WaLead) => l.name || l.wa_name || l.phone;

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<WaLead[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [interest, setInterest] = useState("all");
  const [handoffOnly, setHandoffOnly] = useState(false);
  const [sort, setSort] = useState<"score" | "recent">("score");
  const [open, setOpen] = useState<WaLead | null>(null);

  const load = useCallback(() => {
    api<WaLead[]>("/api/whatsapp/leads").then((r) => { setLeads(r); setError(""); }).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load]);
  useLive((e) => { if (e.type === "message" || e.type === "poll") load(); });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads ?? []) c[l.stage] = (c[l.stage] ?? 0) + 1;
    return c;
  }, [leads]);
  const interests = useMemo(() => [...new Set((leads ?? []).flatMap((l) => codes(l.interest)))].sort(), [leads]);

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    const out = (leads ?? []).filter((l) => {
      if (stage !== "all" && l.stage !== stage) return false;
      if (interest !== "all" && !codes(l.interest).includes(interest)) return false;
      if (handoffOnly && !l.handoff) return false;
      if (q && !`${l.phone} ${l.name} ${l.wa_name} ${l.query} ${l.notes} ${l.ai?.intent ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sort === "score") out.sort((a, b) => (b.ai?.score ?? -1) - (a.ai?.score ?? -1));
    return out;
  }, [leads, query, stage, interest, handoffOnly, sort]);

  const handoffs = (leads ?? []).filter((l) => l.handoff).length;
  const scored = (leads ?? []).filter((l) => l.ai);
  const avg = scored.length ? Math.round(scored.reduce((t, l) => t + (l.ai?.score ?? 0), 0) / scored.length) : null;
  const p1 = scored.filter((l) => l.ai?.priority === "P1" || l.ai?.priority === "P2").length;
  const openChat = (l: WaLead) => router.push(`/whatsapp?c=${encodeURIComponent(`whatsapp:${l.phone}`)}`);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-panel px-4 py-4 md:px-6">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
            <p className="text-sm text-ink-2">Every WhatsApp contact as Freya has profiled them — updated after each message.</p>
          </div>
          <a href="/api/whatsapp/leads?format=csv" className="btn ml-auto"><Download size={15} /> Export CSV</a>
        </div>

        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <Stat label="Leads" value={leads?.length} />
          <Stat label="Top priority (P1–P2)" value={p1} tone={p1 ? "text-brand" : ""} />
          <Stat label="Avg score" value={avg ?? undefined} />
          <Stat label="Need a human" value={handoffs} tone={handoffs ? "text-warn" : ""} />
          <Stat label="Qualified" value={counts.qualified ?? 0} />
          <Stat label="Booking link sent" value={counts.booking_link_sent ?? 0} />
          <Stat label="Members" value={counts.member ?? 0} />
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-56 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-9" placeholder="Search name, phone, query or notes" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <select className="input w-auto" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
            <option value="all">All stages</option>
            {Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v.label}{counts[k] ? ` (${counts[k]})` : ""}</option>)}
          </select>
          <select className="input w-auto" value={interest} onChange={(e) => setInterest(e.target.value)} aria-label="Interest">
            <option value="all">All interests</option>
            {interests.map((i) => <option key={i} value={i}>{LABELS[i] ?? i}</option>)}
          </select>
          <button onClick={() => setSort((v) => (v === "score" ? "recent" : "score"))} className="btn" title="Change sort order">
            <ArrowDownWideNarrow size={15} /> {sort === "score" ? "Top score" : "Recent"}
          </button>
          <button onClick={() => setHandoffOnly((v) => !v)}
            className={`btn ${handoffOnly ? "border-transparent bg-warn-soft text-warn" : ""}`}>
            <Hand size={15} /> Handoff only
          </button>
        </div>
      </div>

      <div className="scroll-thin flex-1 overflow-auto px-4 py-4 md:px-6">
        {error && <div className="mb-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-panel-2 text-left text-[11px] uppercase tracking-wide text-ink-3">
              <tr>
                {["Lead", "Score", "Phone", "Query", "Association", "Interest", "Business owner", "Stage", "Handoff", "Notes", "Last seen", ""].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!leads && !error && [0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={12} className="px-3 py-2"><div className="skeleton h-9" /></td></tr>)}
              {visible.map((l) => (
                <tr key={l.phone} onClick={() => setOpen(l)} className="cursor-pointer border-t border-line align-top hover:bg-panel-2">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={leadName(l)} size={30} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{l.name || l.wa_name || "—"}</div>
                        {l.name && l.wa_name && l.wa_name !== l.name &&<div className="truncate text-[11.5px] text-ink-3">WA: {l.wa_name}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {l.ai ? (
                      <div className="flex items-center gap-2" title={l.ai.summary}>
                        <ScoreRing score={l.ai.score} size={30} />
                        {l.ai.priority && <PriorityBadge priority={l.ai.priority} />}
                      </div>
                    ) : <span className="text-ink-3">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-ink-2">{l.phone}</td>
                  <td className="min-w-44 px-3 py-2.5" title={l.query}>
                    <span className="font-medium">{l.ai?.intent || l.query || "—"}</span>
                  </td>
                  <td className="px-3 py-2.5"><Codes value={l.association} /></td>
                  <td className="px-3 py-2.5"><Codes value={l.interest} /></td>
                  <td className="px-3 py-2.5 capitalize text-ink-2">{l.business_owner || "unknown"}</td>
                  <td className="px-3 py-2.5"><Stage value={l.stage} /></td>
                  <td className="px-3 py-2.5">{l.handoff ? <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn"><Hand size={11} /> Yes</span> : <span className="text-ink-3">—</span>}</td>
                  <td className="max-w-80 px-3 py-2.5 text-ink-2"><p className="line-clamp-2">{l.notes || "—"}</p></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-2" title={l.last_seen ? new Date(l.last_seen).toLocaleString() : ""}>{l.last_seen ? timeAgo(l.last_seen) : "—"}</td>
                  <td className="px-3 py-2.5">
                    <button onClick={(e) => { e.stopPropagation(); openChat(l); }} className="btn px-2 py-1 text-xs" title="Open chat"><MessageCircle size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {leads && !visible.length && <p className="px-4 py-14 text-center text-sm text-ink-3">{leads.length ? "No leads match these filters." : "No leads yet. They appear here after Freya's first reply to a new contact."}</p>}
        </div>
      </div>

      {open && <LeadDrawer lead={open} onClose={() => setOpen(null)} onOpenChat={() => openChat(open)} />}
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: number | undefined; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 px-3 py-1.5">
      <span className="text-ink-3">{label}</span> <span className={`ml-1 font-semibold tabular-nums ${tone}`}>{value ?? "–"}</span>
    </div>
  );
}

function Stage({ value }: { value: string }) {
  const m = STAGES[value] ?? { label: value || "—", chip: "bg-panel-2 text-ink-2" };
  return <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-semibold leading-none ${m.chip}`}>{m.label}</span>;
}

function Codes({ value }: { value: string }) {
  const list = codes(value);
  if (!list.length) return <span className="text-ink-3">—</span>;
  return (
    <div className="flex max-w-56 flex-wrap gap-1">
      {list.map((c) => <span key={c} className="whitespace-nowrap rounded-md bg-panel-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{LABELS[c] ?? c}</span>)}
    </div>
  );
}

function LeadDrawer({ lead, onClose, onOpenChat }: { lead: WaLead; onClose: () => void; onOpenChat: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rows: [string, React.ReactNode][] = [
    ["Phone", lead.phone],
    ["Name", lead.name || "—"],
    ["WhatsApp name", lead.wa_name || "—"],
    ["Stage", <Stage key="s" value={lead.stage} />],
    ["Handoff", lead.handoff ? "Yes — needs a human" : "No"],
    ["Business owner", <span key="b" className="capitalize">{lead.business_owner || "unknown"}</span>],
    ["Association", <Codes key="a" value={lead.association} />],
    ["Interest", <Codes key="i" value={lead.interest} />],
    ["Last seen", lead.last_seen ? new Date(lead.last_seen).toLocaleString() : "—"],
    ["First contact", new Date(lead.created_at).toLocaleString()],
  ];
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Avatar name={leadName(lead)} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{leadName(lead)}</div>
            <div className="text-xs text-ink-3">{lead.phone}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Close"><X size={18} /></button>
        </header>
        <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
          {lead.ai && (
            <section className="flex items-center gap-3 rounded-xl bg-panel-2 p-3">
              <ScoreRing score={lead.ai.score} size={52} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-semibold">
                  {lead.ai.priority && <PriorityBadge priority={lead.ai.priority} />}
                  <span className="truncate">{lead.ai.intent}</span>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-ink-2">{lead.ai.summary}</p>
              </div>
            </section>
          )}
          {lead.ai?.nextStep && (
            <p className="flex items-start gap-1.5 font-medium"><ArrowRight size={15} className="mt-0.5 shrink-0 text-brand" />{lead.ai.nextStep}</p>
          )}
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Query</h3>
            <p>{lead.query || "—"}</p>
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Notes</h3>
            <p className="whitespace-pre-wrap leading-relaxed text-ink-2">{lead.notes || "—"}</p>
          </section>
          <dl className="space-y-2.5">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4">
                <dt className="shrink-0 text-ink-3">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <footer className="border-t border-line px-5 py-3">
          <button onClick={onOpenChat} className="btn btn-primary w-full"><MessageCircle size={16} /> Open WhatsApp chat</button>
        </footer>
      </aside>
    </div>
  );
}
