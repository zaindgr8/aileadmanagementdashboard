"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, Hand, Search } from "lucide-react";
import { api, displayName, STAGE_META, timeAgo, useLive } from "@/lib/whatsapp/client";
import { LEAD_STAGES, type Conversation, type LeadStage } from "@/lib/whatsapp/types";
import { Avatar, ScoreRing } from "@/components/whatsapp/ui";

type Conv = Conversation & { sessionOpen: boolean };

export default function Pipeline() {
  const router = useRouter();
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStage | null>(null);

  const load = useCallback(() => api<Conv[]>("/api/whatsapp/conversations").then(setConvs).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useLive((e) => { if (e.type === "conversation" || e.type === "message" || e.type === "poll") load(); });

  const columns = useMemo(() => {
    const q = query.toLowerCase().trim();
    const cols = Object.fromEntries(LEAD_STAGES.map((s) => [s, [] as Conv[]])) as Record<LeadStage, Conv[]>;
    for (const c of convs ?? []) {
      if (!c.lead) continue;
      if (q && !`${displayName(c)} ${c.phone} ${c.lead.company} ${c.lead.intent} ${c.lead.summary}`.toLowerCase().includes(q)) continue;
      cols[c.lead.stage].push(c);
    }
    for (const s of LEAD_STAGES) cols[s].sort((a, b) => b.lead!.score - a.lead!.score || b.lastMessageAt.localeCompare(a.lastMessageAt));
    return cols;
  }, [convs, query]);
  const unscored = (convs ?? []).filter((c) => !c.lead).length;

  const move = async (id: string, stage: LeadStage) => {
    const c = convs?.find((x) => x.id === id);
    if (!c?.lead || c.lead.stage === stage) return;
    const closing = stage === "won" || stage === "lost";
    setConvs((cs) => cs?.map((x) => (x.id === id ? { ...x, lead: { ...x.lead!, stage, stageLocked: true }, ...(closing ? { status: "resolved" as const } : {}) } : x)) ?? cs);
    await api(`/api/whatsapp/conversations/${encodeURIComponent(id)}`, { method: "PATCH", json: { lead: { stage }, ...(closing ? { status: "resolved" } : {}) } }).catch(() => load());
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-4 md:px-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
          <p className="text-sm text-ink-2">Every WhatsApp lead, scored by AI. Drag a card to change its stage.</p>
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className="input pl-9" placeholder="Filter leads" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <div className="scroll-thin flex flex-1 snap-x gap-3 overflow-x-auto p-4 md:px-6">
        {LEAD_STAGES.map((stage) => {
          const items = columns[stage];
          const m = STAGE_META[stage];
          const avg = items.length ? Math.round(items.reduce((s, c) => s + c.lead!.score, 0) / items.length) : null;
          return (
            <section key={stage}
              onDragOver={(e) => { e.preventDefault(); setOver(stage); }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, stage); }}
              className={`flex w-[280px] shrink-0 snap-start flex-col rounded-2xl border transition md:w-auto md:min-w-[230px] md:flex-1 ${over === stage && dragging ? "border-brand bg-brand-soft/40" : "border-transparent bg-panel-2/60"}`}>
              <header className="flex items-center gap-2 px-3 pb-2 pt-3">
                <span className={`h-2 w-2 rounded-full ${m.dot}`} />
                <h2 className="text-sm font-semibold">{m.label}</h2>
                <span className="rounded-full bg-panel px-1.5 text-[11px] font-semibold tabular-nums text-ink-2">{items.length}</span>
                {avg != null && <span className="ml-auto text-[11px] tabular-nums text-ink-3">avg {avg}</span>}
              </header>
              <ul className="scroll-thin flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {!convs && [0, 1].map((i) => <li key={i} className="skeleton h-28" />)}
                {items.map((c) => (
                  <li key={c.id} draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; setDragging(c.id); }}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    onClick={() => router.push(`/whatsapp?c=${encodeURIComponent(c.id)}`)}
                    className={`card group cursor-pointer p-3 transition hover:-translate-y-px hover:border-ink-3/40 ${dragging === c.id ? "opacity-40" : ""}`}>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={displayName(c)} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{displayName(c)}</div>
                        <div className="truncate text-[11.5px] text-ink-3">{c.lead!.company || c.lead!.intent || c.phone}</div>
                      </div>
                      <ScoreRing score={c.lead!.score} size={28} />
                    </div>
                    {c.lead!.summary && <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-ink-2">{c.lead!.summary}</p>}
                    {c.lead!.nextStep && stage !== "lost" && (
                      <p className="mt-2 flex items-start gap-1.5 text-[12px] font-medium"><ArrowRight size={13} className="mt-px shrink-0 text-brand" /><span className="line-clamp-2">{c.lead!.nextStep}</span></p>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-3">
                      {c.lead!.budget && <span className="rounded bg-panel-2 px-1.5 py-0.5 font-medium text-ink-2">{c.lead!.budget}</span>}
                      {c.needsHuman && <Hand size={12} className="text-warn" aria-label="Needs a human" />}
                      {c.aiEnabled && <Bot size={12} className="text-ai" aria-label="Agent on" />}
                      {c.unread > 0 && <span className="h-1.5 w-1.5 rounded-full bg-brand" title={`${c.unread} unread`} />}
                      <span className="ml-auto tabular-nums">{timeAgo(c.lastMessageAt)}</span>
                    </div>
                  </li>
                ))}
                {convs && !items.length && <li className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-xs text-ink-3">No leads</li>}
              </ul>
            </section>
          );
        })}
      </div>
      {unscored > 0 && <p className="px-6 pb-3 text-xs text-ink-3">{unscored} {unscored === 1 ? "chat is" : "chats are"} being scored and will appear here shortly.</p>}
    </div>
  );
}
