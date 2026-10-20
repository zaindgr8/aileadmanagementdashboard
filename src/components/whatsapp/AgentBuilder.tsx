"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Rocket, Sparkles, X } from "lucide-react";
import { api } from "@/lib/whatsapp/client";
import type { SessionUser } from "@/lib/auth/modules";

export interface AgentDraft {
  agentName: string;
  businessName: string;
  systemPrompt: string;
  handoffKeywords: string[];
  handoffMessage: string;
  leadCriteria: string;
  gaps: string[];
}
type Sources = { website: boolean; siteError: string | null; docs: number; details: boolean };

/** "Draft from business info": Gemini writes the agent from the client's onboarding details, documents and website. */
export function DraftAgentButton({ onApply }: { onApply: (d: AgentDraft) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [sources, setSources] = useState<Sources | null>(null);

  const run = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ draft: AgentDraft; sources: Sources }>("/api/whatsapp/agent-draft", { method: "POST" });
      setDraft(r.draft); setSources(r.sources);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-ai-soft/60 px-3 py-2.5">
        <Sparkles size={15} className="text-ai" />
        <span className="flex-1 text-xs text-ink-2">Build the persona from the business details, documents and website the client gave on <b>Get started</b>.</span>
        <button type="button" className="btn h-8 px-3 text-xs text-ai" disabled={busy} onClick={run}>
          {busy ? <><Loader2 size={13} className="animate-spin" />Reading their business…</> : <><Sparkles size={13} />Draft from business info</>}
        </button>
      </div>
      {err && <p className="mb-3 text-xs text-danger">{err}</p>}

      {draft && (
        <div data-modal className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4 backdrop-blur-[2px]" onClick={() => setDraft(null)}>
          <div className="card anim-pop flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <Sparkles size={17} className="text-ai" /><h3 className="font-semibold">Draft agent: {draft.agentName} for {draft.businessName}</h3>
              <button onClick={() => setDraft(null)} className="ml-auto text-ink-3"><X size={18} /></button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm">
              {sources && (
                <p className="text-xs text-ink-3">
                  Built from: {[sources.details && "their answers", sources.docs && `${sources.docs} document${sources.docs === 1 ? "" : "s"}`, sources.website && "their website"].filter(Boolean).join(", ") || "very little"}.
                  {sources.siteError && <span className="text-warn"> Website: {sources.siteError}</span>}
                </p>
              )}
              {draft.gaps.length > 0 && (
                <div className="rounded-xl bg-warn-soft px-4 py-3 text-warn">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold"><AlertTriangle size={13} />Missing: ask the client, then add to the prompt</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs">{draft.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
                </div>
              )}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-2">Persona & instructions (you can edit before using it)</span>
                <textarea className="input min-h-80 font-mono text-[12.5px] leading-relaxed" value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <div><span className="mb-1 block text-xs font-medium text-ink-2">Qualified / hot lead</span><p className="whitespace-pre-wrap rounded-lg bg-panel-2 px-3 py-2 text-xs">{draft.leadCriteria}</p></div>
                <div>
                  <span className="mb-1 block text-xs font-medium text-ink-2">Handoff words and message</span>
                  <p className="rounded-lg bg-panel-2 px-3 py-2 text-xs">{draft.handoffKeywords.join(", ")}<br /><span className="text-ink-3">“{draft.handoffMessage}”</span></p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
              <span className="mr-auto text-xs text-ink-3">Fills in the fields below; nothing changes until you click Save.</span>
              <button className="btn" onClick={() => setDraft(null)}>Discard</button>
              <button className="btn btn-primary" onClick={() => { onApply(draft); setDraft(null); }}><Check size={15} />Use this draft</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Platform admins: mark the client's agent as built and live (shows on their Get started checklist). */
export function GoLiveBar() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [liveAt, setLiveAt] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<SessionUser>("/api/me").then(setMe).catch(() => {});
    api<{ agentLiveAt: string | null }>("/api/onboarding").then((r) => setLiveAt(r.agentLiveAt)).catch(() => {});
  }, []);
  if (!me?.platformAdmin || liveAt === undefined) return null;

  const toggle = async () => {
    if (!liveAt && !confirm("Mark this agent as live? It switches the agent on for this workspace and tells the client on their Get started page.")) return;
    setBusy(true);
    try {
      await api("/api/onboarding/agent", { method: "POST", json: { live: !liveAt } });
      setLiveAt(liveAt ? null : new Date().toISOString());
    } finally { setBusy(false); }
  };
  return (
    <div className={`mb-6 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${liveAt ? "border-ok/30 bg-ok-soft/50" : "border-dashed border-line"}`}>
      <Rocket size={16} className={liveAt ? "text-ok" : "text-ink-3"} />
      <span className="flex-1">{liveAt ? <>Agent marked <b>live</b> on {new Date(liveAt).toLocaleDateString()}. The client sees it on Get started.</> : <>Platform admin: when the agent is built and tested, mark it live for {me.workspaceName}.</>}</span>
      <button className={`btn h-8 px-3 text-xs ${liveAt ? "" : "btn-primary"}`} disabled={busy} onClick={toggle}>
        {busy && <Loader2 size={13} className="animate-spin" />}{liveAt ? "Undo live" : "Mark agent live"}
      </button>
    </div>
  );
}
