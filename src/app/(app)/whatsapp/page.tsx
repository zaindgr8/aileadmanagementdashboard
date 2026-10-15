"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow, ArrowLeft, Bot, Building2, Check, CheckCheck, CheckCircle2, Clock, FileText, Hand, Loader2,
  Mail, PanelRight, RefreshCw, Search, Send, Sparkles, Target, TriangleAlert, User, Wallet, X,
} from "lucide-react";
import { api, displayName, STAGE_META, timeAgo, useLive } from "@/lib/whatsapp/client";
import { LEAD_STAGES, type Conversation, type Lead, type Message } from "@/lib/whatsapp/types";
import { Avatar, ScoreRing, StageChip } from "@/components/whatsapp/ui";

type Conv = Conversation & { sessionOpen: boolean };
type Template = { sid: string; name: string; language: string; status: string; variables: Record<string, string> };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "hot", label: "Hot" },
  { key: "human", label: "Needs human" },
  { key: "ai", label: "AI" },
  { key: "manual", label: "Manual" },
  { key: "resolved", label: "Resolved" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

function readPref<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; }
}
function writePref(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch {}
}

export default function Inbox() {
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<"recent" | "score">("recent");
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(() => api<Conv[]>("/api/whatsapp/conversations").then(setConvs).catch(() => {}), []);
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore saved preferences after hydration
    setSort(readPref("inbox.sort", "recent"));
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setSelected(c);
  }, [loadList]);

  const select = useCallback((id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id); else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  }, []);

  // The command palette opens chats through this event.
  useEffect(() => {
    const on = (e: Event) => select((e as CustomEvent<string>).detail);
    window.addEventListener("open-chat", on);
    return () => window.removeEventListener("open-chat", on);
  }, [select]);

  useLive((e) => { if (e.type !== "hello" && e.type !== "agent") loadList(); });

  const flash = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ imported: number }>("/api/whatsapp/sync", { method: "POST", json: {} });
      flash(`Synced ${r.imported} messages from Twilio`);
      loadList();
    } catch (e) { flash((e as Error).message); }
    setSyncing(false);
  };

  const list = useMemo(() => convs ?? [], [convs]);
  const counts = useMemo(() => ({
    unread: list.filter((c) => c.unread > 0).length,
    hot: list.filter((c) => c.lead?.stage === "hot").length,
    human: list.filter((c) => c.needsHuman).length,
  }), [list]);

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    const out = list.filter((c) => {
      if (q && !`${displayName(c)} ${c.phone} ${c.lastMessagePreview} ${c.lead?.company ?? ""} ${c.lead?.intent ?? ""} ${c.tags.join(" ")}`.toLowerCase().includes(q)) return false;
      switch (filter) {
        case "unread": return c.unread > 0;
        case "hot": return c.lead?.stage === "hot";
        case "human": return c.needsHuman;
        case "ai": return c.aiEnabled && c.status === "open";
        case "manual": return !c.aiEnabled && c.status === "open";
        case "resolved": return c.status === "resolved";
        default: return true;
      }
    });
    if (sort === "score") out.sort((a, b) => (b.lead?.score ?? -1) - (a.lead?.score ?? -1));
    return out;
  }, [list, filter, query, sort]);

  const current = list.find((c) => c.id === selected) ?? null;

  // Keyboard: J/K or ↓/↑ move through chats, / searches, Esc closes the chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && document.activeElement === searchRef.current) { searchRef.current?.blur(); return; }
      if (isTyping(e.target) || document.querySelector("[data-modal]")) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === "Escape") { select(null); return; }
      const step = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
      if (!step || !visible.length) return;
      e.preventDefault();
      const i = visible.findIndex((c) => c.id === selected);
      const next = visible[Math.max(0, Math.min(visible.length - 1, i < 0 ? 0 : i + step))];
      select(next.id);
      document.querySelector(`[data-conv="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected, select]);

  const toggleSort = () => { const s = sort === "recent" ? "score" : "recent"; setSort(s); writePref("inbox.sort", s); };

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <section className={`${selected ? "hidden md:flex" : "flex"} w-full flex-col border-r border-line bg-panel md:w-[340px] md:shrink-0`}>
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
          {convs && <span className="text-xs tabular-nums text-ink-3">{visible.length}</span>}
          <button onClick={toggleSort} className="btn btn-ghost ml-auto px-2 py-1.5 text-xs" title="Change sort order">
            <ArrowDownWideNarrow size={14} /> {sort === "recent" ? "Recent" : "Top score"}
          </button>
          <button onClick={sync} disabled={syncing} className="btn btn-ghost px-2 py-1.5 text-xs" title="Import past messages from Twilio">
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> Sync
          </button>
        </div>
        <div className="px-4 pb-2">
          <label className="relative block">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input ref={searchRef} className="input pl-9 pr-9" placeholder="Search leads, companies, messages" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="kbd absolute right-2.5 top-1/2 hidden -translate-y-1/2 md:inline-grid">/</span>
          </label>
        </div>
        <div className="scroll-thin flex gap-1.5 overflow-x-auto px-4 pb-3">
          {FILTERS.map((f) => {
            const n = f.key === "unread" ? counts.unread : f.key === "human" ? counts.human : f.key === "hot" ? counts.hot : 0;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium transition ${filter === f.key ? "bg-ink text-panel" : "bg-panel-2 text-ink-2 hover:text-ink"}`}>
                {f.label}{n > 0 && <span className={`ml-1.5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${f.key === "human" ? "bg-warn text-panel" : "bg-brand text-brand-ink"}`}>{n}</span>}
              </button>
            );
          })}
        </div>
        <ul className="scroll-thin flex-1 overflow-y-auto">
          {!convs && Array.from({ length: 7 }, (_, i) => (
            <li key={i} className="flex gap-3 px-4 py-3">
              <span className="skeleton h-[42px] w-[42px] shrink-0 rounded-full" />
              <span className="flex-1 space-y-2 pt-1"><span className="skeleton block h-3 w-2/3" /><span className="skeleton block h-3 w-full" /></span>
            </li>
          ))}
          {visible.map((c) => (
            <li key={c.id}>
              <button onClick={() => select(c.id)} data-conv={c.id}
                className={`relative flex w-full gap-3 px-4 py-3 text-left transition ${selected === c.id ? "bg-brand-soft/70" : "hover:bg-panel-2"}`}>
                {selected === c.id && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-brand" />}
                <span className="relative">
                  <Avatar name={displayName(c)} />
                  {c.lead && <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel ${STAGE_META[c.lead.stage].dot}`} title={STAGE_META[c.lead.stage].label} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${c.unread ? "font-semibold" : "font-medium"}`}>{displayName(c)}</span>
                    <span className={`shrink-0 text-[11px] tabular-nums ${c.unread ? "font-medium text-brand" : "text-ink-3"}`}>{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  {c.lead?.intent && <div className="truncate text-[11.5px] font-medium text-ink-2">{c.lead.intent}{c.lead.company ? ` · ${c.lead.company}` : ""}</div>}
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="truncate text-[13px] text-ink-3">{c.lastMessagePreview || "No messages"}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      {c.needsHuman && <span title="Needs a human" className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn">HUMAN</span>}
                      {c.aiEnabled ? <Bot size={14} className="text-ai" aria-label="AI on" /> : <User size={14} className="text-ink-3" aria-label="Manual" />}
                      {c.lead && <ScoreRing score={c.lead.score} size={22} />}
                      {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-semibold text-brand-ink">{c.unread}</span>}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ))}
          {convs && !visible.length && (
            <li className="px-6 py-16 text-center text-sm text-ink-3">
              {list.length ? "No chats match this filter." : "No chats yet. When someone messages your WhatsApp number, it appears here — or click Sync to import history."}
            </li>
          )}
        </ul>
        <div className="hidden gap-3 border-t border-line px-4 py-2 text-[11px] text-ink-3 md:flex">
          <span><span className="kbd">J</span> <span className="kbd">K</span> move</span>
          <span><span className="kbd">/</span> search</span>
          <span className="ml-auto"><span className="kbd">⌘</span> <span className="kbd">K</span> jump</span>
        </div>
      </section>

      {/* Thread */}
      {current ? (
        <Thread key={current.id} conv={current} onBack={() => select(null)} onChanged={loadList} flash={flash}
          setLocal={(p) => setConvs((cs) => cs?.map((c) => (c.id === current.id ? { ...c, ...p } : c)) ?? cs)} />
      ) : (
        <div className="chat-wallpaper hidden flex-1 place-items-center md:grid">
          <div className="anim-rise text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-panel text-brand shadow-[var(--shadow)]"><Target size={28} /></div>
            <p className="font-semibold">Pick a lead to start</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-ink-2">Watch the AI qualify leads live, take over any chat, or hand it back.</p>
            {counts.hot > 0 && (
              <button onClick={() => setFilter("hot")} className="btn mt-4 text-xs">
                <span className="h-2 w-2 rounded-full bg-brand" /> {counts.hot} hot {counts.hot === 1 ? "lead" : "leads"} waiting
              </button>
            )}
          </div>
        </div>
      )}

      {toast && <div className="anim-rise fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-sm text-panel shadow-lg">{toast}</div>}
    </div>
  );
}

function Thread({ conv, onBack, onChanged, flash, setLocal }: {
  conv: Conv; onBack: () => void; onChanged: () => void; flash: (m: string) => void; setLocal: (p: Partial<Conv>) => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [showLead, setShowLead] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<Message[]>([]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a saved preference after hydration
  useEffect(() => { setShowLead(readPref("inbox.leadPanel", window.innerWidth >= 1280 ? "1" : "0") === "1"); }, []);
  const toggleLead = () => setShowLead((s) => { writePref("inbox.leadPanel", s ? "0" : "1"); return !s; });

  const load = useCallback(() => {
    api<{ messages: Message[] }>(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}`)
      .then((r) => setMessages([...r.messages, ...pendingRef.current]))
      .catch(() => {});
  }, [conv.id]);

  const patch = useCallback(async (p: Partial<Conversation>) => {
    setLocal(p as Partial<Conv>); // optimistic
    await api(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}`, { method: "PATCH", json: p }).catch((e) => flash(e.message));
    onChanged();
  }, [conv.id, flash, onChanged, setLocal]);

  useEffect(() => {
    load();
    if (conv.unread) patch({ unread: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id]);

  useLive((e) => {
    if (e.conversationId === conv.id || e.type === "poll") {
      if (e.type === "conversation" || e.type === "agent") return; // the list reload already covers these
      load();
      if (e.type === "message" && document.visibilityState === "visible")
        api(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}`, { method: "PATCH", json: { unread: 0 } }).catch(() => {});
    }
  });

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages?.length]);

  // E resolves/reopens, R focuses the reply box, I toggles the lead panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("[data-modal]")) return;
      if (e.key === "e") patch({ status: conv.status === "open" ? "resolved" : "open" });
      else if (e.key === "r") { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.key === "i") toggleLead();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const send = async (extra?: { contentSid: string }) => {
    const body = draft.trim();
    if (!extra && !body) return;
    // Show the message immediately; it settles once Twilio accepts it.
    const temp: Message = {
      id: `pending_${crypto.randomUUID()}`, conversationId: conv.id, direction: "outbound", author: "agent",
      body: extra ? "Template message" : body, media: [], status: "sending", createdAt: new Date().toISOString(),
    };
    pendingRef.current = [...pendingRef.current, temp];
    setMessages((m) => [...(m ?? []), temp]);
    setDraft("");
    if (conv.aiEnabled) { setLocal({ aiEnabled: false }); flash("You took over — AI paused for this chat"); }
    try {
      await api(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}/messages`, { method: "POST", json: extra ?? { body } });
    } catch (e) {
      flash((e as Error).message);
      if (!extra) setDraft(body);
    }
    pendingRef.current = pendingRef.current.filter((m) => m.id !== temp.id);
    load();
    onChanged();
  };

  const aiDraft = async () => {
    setDrafting(true);
    try {
      const r = await api<{ text: string; handoff: boolean; reason?: string }>(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}/suggest`, { method: "POST" });
      if (r.handoff) flash(`AI suggests a human handles this: ${r.reason}`);
      else { setDraft(r.text); inputRef.current?.focus(); }
    } catch (e) { flash((e as Error).message); }
    setDrafting(false);
  };

  const openTemplates = async () => {
    try { setTemplates(await api<Template[]>("/api/whatsapp/templates")); } catch (e) { flash((e as Error).message); }
  };

  const name = displayName(conv);
  const groups = groupByDay(messages ?? []);

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-panel px-3 py-2.5 md:px-5">
          <button onClick={onBack} className="rounded-lg p-1.5 text-ink-2 hover:bg-panel-2 md:hidden" aria-label="Back"><ArrowLeft size={20} /></button>
          <button onClick={toggleLead} className="flex min-w-0 items-center gap-3 text-left">
            <Avatar name={name} size={38} />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{name}</span>
                {conv.lead && <StageChip stage={conv.lead.stage} className="hidden sm:inline-flex" />}
              </span>
              <span className="block truncate text-xs text-ink-3">{conv.phone}{conv.lead?.company ? ` · ${conv.lead.company}` : conv.profileName && conv.name ? ` · ${conv.profileName}` : ""}</span>
            </span>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <AiSwitch on={conv.aiEnabled} onChange={(v) => patch({ aiEnabled: v, ...(v ? { needsHuman: false } : {}) })} />
            <button onClick={() => patch({ status: conv.status === "open" ? "resolved" : "open" })}
              className="btn hidden px-2.5 py-1.5 text-xs sm:inline-flex" title={`${conv.status === "open" ? "Mark resolved" : "Reopen"}  (E)`}>
              <CheckCircle2 size={14} className={conv.status === "resolved" ? "text-ok" : ""} />
              {conv.status === "open" ? "Resolve" : "Reopen"}
            </button>
            <button onClick={toggleLead} className={`btn px-2 py-1.5 ${showLead ? "bg-panel-2" : ""}`} title="Lead details  (I)" aria-pressed={showLead}>
              <PanelRight size={16} />
            </button>
          </div>
        </header>

        {conv.needsHuman && (
          <div className="flex items-center gap-2 border-b border-line bg-warn-soft px-5 py-2 text-sm text-warn">
            <Hand size={16} className="shrink-0" />
            <span className="min-w-0 flex-1"><b>Needs a human.</b> {conv.handoffReason}</span>
            <button onClick={() => patch({ aiEnabled: true, needsHuman: false })} className="shrink-0 text-xs font-semibold underline">Give back to AI</button>
          </div>
        )}

        <div className="chat-wallpaper scroll-thin flex-1 overflow-y-auto px-3 py-4 md:px-8">
          {!messages && (
            <div className="space-y-3 pt-4">
              {[60, 40, 70, 35].map((w, i) => <div key={i} className={`flex ${i % 2 ? "justify-end" : ""}`}><span className="skeleton block h-12" style={{ width: `${w}%` }} /></div>)}
            </div>
          )}
          {groups.map(([day, items]) => (
            <div key={day}>
              <div className="sticky top-0 z-10 my-3 text-center"><span className="rounded-lg bg-panel/90 px-3 py-1 text-[11px] font-medium text-ink-2 shadow-sm backdrop-blur">{day}</span></div>
              {items.map((m) => <Bubble key={m.id} m={m} />)}
            </div>
          ))}
          {messages && !messages.length && <p className="mt-20 text-center text-sm text-ink-3">No messages yet.</p>}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <footer className="border-t border-line bg-panel px-3 py-3 md:px-5">
          {!conv.sessionOpen && conv.lastInboundAt ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-panel-2 px-4 py-3 text-sm">
              <Clock size={16} className="text-warn" />
              <span className="flex-1 text-ink-2">The 24-hour WhatsApp window is closed. You can only send an approved template until the customer replies.</span>
              <button onClick={openTemplates} className="btn btn-primary py-1.5 text-xs"><FileText size={14} /> Send template</button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <button onClick={aiDraft} disabled={drafting} className="btn h-10 shrink-0 px-2.5 text-ai" title="Draft a reply with AI (you review before sending)">
                {drafting ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              </button>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                  else if (e.key === "Escape") inputRef.current?.blur();
                }}
                rows={Math.min(5, Math.max(1, draft.split("\n").length))}
                placeholder={conv.aiEnabled ? "Type to take over from the AI…" : "Type a message"}
                className="input scroll-thin max-h-40 min-h-10 resize-none py-2.5"
              />
              <button onClick={() => send()} disabled={!draft.trim()} className="btn btn-primary h-10 w-10 shrink-0 p-0" aria-label="Send">
                <Send size={17} />
              </button>
            </div>
          )}
          <p className="mt-1.5 hidden text-[11px] text-ink-3 md:block">
            {conv.aiEnabled ? "AI is replying automatically. Sending a message yourself pauses it for this chat." : "AI is off for this chat — you're in control."}
            <span className="ml-2 opacity-70"><span className="kbd">R</span> reply · <span className="kbd">E</span> resolve · <span className="kbd">I</span> lead</span>
          </p>
        </footer>
      </section>

      {showLead && <LeadPanel conv={conv} onClose={toggleLead} onSave={patch} flash={flash} onChanged={onChanged} />}

      {templates && (
        <div data-modal className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4 backdrop-blur-[2px]" onClick={() => setTemplates(null)}>
          <div className="card anim-pop max-h-[70vh] w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h3 className="font-semibold">Approved templates</h3>
              <button onClick={() => setTemplates(null)} className="text-ink-3"><X size={18} /></button>
            </div>
            <ul className="scroll-thin max-h-[55vh] overflow-y-auto">
              {templates.map((t) => (
                <li key={t.sid} className="flex items-center gap-3 border-b border-line px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="text-xs text-ink-3">{t.language} · {t.status}</div>
                  </div>
                  <button className="btn py-1 text-xs" onClick={() => { setTemplates(null); send({ contentSid: t.sid }); }}>Send</button>
                </li>
              ))}
              {!templates.length && <li className="px-5 py-10 text-center text-sm text-ink-3">No templates found. Create one in Twilio Console → Content Template Builder.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function AiSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} title={on ? "AI is replying — click to take over" : "You're in control — click to hand back to the AI"}
      className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${on ? "border-transparent bg-ai-soft text-ai" : "border-line bg-panel text-ink-2"}`}>
      {on ? <Bot size={14} /> : <User size={14} />}
      <span className="hidden sm:inline">{on ? "AI on" : "Manual"}</span>
      <span className={`relative h-4 w-7 rounded-full transition ${on ? "bg-ai" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Bubble({ m }: { m: Message }) {
  const out = m.direction === "outbound";
  const bg = !out ? "bg-bubble-in" : m.author === "ai" ? "bg-bubble-ai" : "bg-bubble-out";
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`anim-rise mb-1.5 flex ${out ? "justify-end" : "justify-start"} ${m.status === "sending" ? "opacity-70" : ""}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-[0_1px_0.5px_rgba(0,0,0,0.08)] md:max-w-[65%] ${bg} ${out ? "rounded-tr-md" : "rounded-tl-md"}`}>
        {out && (
          <div className={`mb-0.5 flex items-center gap-1 text-[11px] font-semibold ${m.author === "ai" ? "text-ai" : "text-brand"}`}>
            {m.author === "ai" ? <><Bot size={12} /> AI agent</> : <><User size={12} /> You</>}
          </div>
        )}
        {m.media.map((x, i) => <MediaView key={i} url={x.url} type={x.contentType} />)}
        {m.body && <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">{m.body}</p>}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-ink-3">
          {time}
          {out && <StatusTick status={m.status} />}
        </div>
        {m.error && <p className="mt-1 flex items-center gap-1 text-[11px] text-danger"><TriangleAlert size={12} /> {m.error}</p>}
      </div>
    </div>
  );
}

function StatusTick({ status }: { status: string }) {
  if (status === "read") return <CheckCheck size={14} className="text-[#53bdeb]" />;
  if (status === "delivered") return <CheckCheck size={14} />;
  if (status === "sent") return <Check size={14} />;
  if (status === "failed" || status === "undelivered") return <TriangleAlert size={12} className="text-danger" />;
  if (status === "demo") return <span title="Demo mode — not actually sent"><Check size={14} /></span>;
  if (status === "sending") return <Loader2 size={11} className="animate-spin" />;
  return <Clock size={11} />;
}

function MediaView({ url, type }: { url: string; type: string }) {
  const src = `/api/whatsapp/media?url=${encodeURIComponent(url)}`;
  // eslint-disable-next-line @next/next/no-img-element
  if (type.startsWith("image/")) return <img src={src} alt="" loading="lazy" className="mb-1 max-h-72 rounded-lg" />;
  if (type.startsWith("audio/")) return <audio controls preload="none" src={src} className="mb-1 max-w-full" />;
  if (type.startsWith("video/")) return <video controls preload="none" src={src} className="mb-1 max-h-72 rounded-lg" />;
  return <a href={src} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 text-sm underline"><FileText size={14} /> Attachment ({type || "file"})</a>;
}

function LeadPanel({ conv, onClose, onSave, flash, onChanged }: {
  conv: Conv; onClose: () => void; onSave: (p: Partial<Conversation>) => Promise<void>; flash: (m: string) => void; onChanged: () => void;
}) {
  const [name, setName] = useState(conv.name);
  const [notes, setNotes] = useState(conv.notes);
  const [tag, setTag] = useState("");
  const [scoring, setScoring] = useState(false);
  const lead = conv.lead;

  const rescore = async () => {
    setScoring(true);
    try { await api<Lead>(`/api/whatsapp/conversations/${encodeURIComponent(conv.id)}/analyze`, { method: "POST" }); onChanged(); }
    catch (e) { flash((e as Error).message); }
    setScoring(false);
  };
  const setStage = (stage: Lead["stage"]) => {
    onSave({ lead: { ...(lead as Lead), stage }, ...(stage === "won" || stage === "lost" ? { status: "resolved" as const } : {}) });
  };

  return (
    <aside className="anim-rise fixed inset-y-0 right-0 z-30 flex w-[320px] flex-col border-l border-line bg-panel shadow-xl lg:static lg:shadow-none">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Target size={15} className="text-brand" /> Lead</h3>
        <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close"><X size={18} /></button>
      </div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
        {lead ? (
          <>
            <div className="flex items-center gap-4">
              <ScoreRing score={lead.score} size={64} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{lead.intent || "Lead"}</div>
                <div className="text-xs text-ink-3">
                  {lead.source === "ai" ? "Scored by AI" : "Scored by rules"} · {timeAgo(lead.analyzedAt)}
                </div>
                <button onClick={rescore} disabled={scoring} className="mt-1 flex items-center gap-1 text-xs font-medium text-brand disabled:opacity-50">
                  {scoring ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Re-score
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-2">Stage {lead.stageLocked && <span className="font-normal text-ink-3">· set by you</span>}</div>
              <div className="grid grid-cols-5 gap-1 rounded-xl bg-panel-2 p-1">
                {LEAD_STAGES.map((s) => (
                  <button key={s} onClick={() => setStage(s)}
                    className={`rounded-lg py-1.5 text-[11px] font-semibold transition ${lead.stage === s ? `${STAGE_META[s].chip} shadow-sm ring-1 ring-line` : "text-ink-3 hover:text-ink"}`}>
                    {STAGE_META[s].label}
                  </button>
                ))}
              </div>
            </div>

            {lead.summary && <p className="leading-relaxed text-ink-2">{lead.summary}</p>}

            {lead.nextStep && (
              <div className="rounded-xl border border-brand/25 bg-brand-soft px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-brand">Next step</div>
                <div className="mt-0.5 font-medium">{lead.nextStep}</div>
              </div>
            )}

            <dl className="space-y-2">
              <Fact icon={Mail} k="Email" v={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
              <Fact icon={Building2} k="Company" v={lead.company} />
              <Fact icon={Wallet} k="Budget" v={lead.budget} />
              <Fact icon={Target} k="Interest" v={lead.interest} />
            </dl>
          </>
        ) : (
          <div className="rounded-xl bg-panel-2 px-4 py-5 text-center">
            <p className="text-ink-2">This chat hasn&apos;t been scored yet.</p>
            <button onClick={rescore} disabled={scoring} className="btn btn-primary mt-3 text-xs">
              {scoring ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Score this lead
            </button>
          </div>
        )}

        <div className="h-px bg-line" />

        <Field label="Display name">
          <input className="input" value={name} placeholder={conv.profileName || "Add a name"} onChange={(e) => setName(e.target.value)} onBlur={() => name !== conv.name && onSave({ name })} />
        </Field>
        <Field label="Tags">
          {conv.tags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {conv.tags.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-xs">
                  {t}<button onClick={() => onSave({ tags: conv.tags.filter((x) => x !== t) })} className="text-ink-3" aria-label={`Remove ${t}`}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <input className="input" value={tag} placeholder="Add tag + Enter" onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && tag.trim()) { onSave({ tags: [...new Set([...conv.tags, tag.trim()])] }); setTag(""); } }} />
        </Field>
        <Field label="Internal notes">
          <textarea className="input min-h-24" value={notes} placeholder="Only your team sees this" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== conv.notes && onSave({ notes })} />
        </Field>
        <dl className="space-y-2 text-xs">
          <Row k="WhatsApp profile" v={conv.profileName || "—"} />
          <Row k="First contact" v={new Date(conv.createdAt).toLocaleString()} />
          <Row k="Last customer message" v={conv.lastInboundAt ? new Date(conv.lastInboundAt).toLocaleString() : "—"} />
          <Row k="24h window" v={conv.sessionOpen ? "Open" : "Closed"} />
        </dl>
      </div>
    </aside>
  );
}

function Fact({ icon: Icon, k, v, href }: { icon: React.ComponentType<{ size?: number; className?: string }>; k: string; v: string; href?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={14} className="shrink-0 text-ink-3" />
      <dt className="w-16 shrink-0 text-xs text-ink-3">{k}</dt>
      <dd className="min-w-0 flex-1 truncate font-medium">
        {v ? href ? <a href={href} className="hover:text-brand">{v}</a> : v : <span className="font-normal text-ink-3">—</span>}
      </dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1.5 text-xs font-medium text-ink-2">{label}</div>{children}</div>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-3">{k}</dt><dd className="text-right font-medium">{v}</dd></div>;
}

function groupByDay(messages: Message[]): [string, Message[]][] {
  const out = new Map<string, Message[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  for (const m of messages) {
    const d = new Date(m.createdAt);
    const key = d.toDateString() === today ? "Today" : d.toDateString() === yesterday ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(m);
  }
  return [...out];
}
