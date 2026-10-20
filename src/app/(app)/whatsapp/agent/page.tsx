"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, Copy, Forward, Hand, Loader2, Pause, Play, SkipForward, Target, Workflow } from "lucide-react";
import { api, timeAgo, useLive } from "@/lib/whatsapp/client";
import type { AgentEvent, Settings } from "@/lib/whatsapp/types";
import { DraftAgentButton, GoLiveBar, type AgentDraft } from "@/components/whatsapp/AgentBuilder";

type Env = { twilioConfigured: boolean; aiConfigured: boolean; geminiModel: string | null; whatsappFrom: string; publicBaseUrl: string };

// Gemini models offered for the built-in agent (mirrors GEMINI_MODELS in lib/ai/gemini.ts).
const MODELS = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", note: "Newest, fast and smart (recommended)" },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", note: "Fast and dependable" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", note: "Deepest reasoning, slower" },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", note: "Fastest, lowest cost" },
] as const;

export default function AgentPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [env, setEnv] = useState<Env | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api<{ settings: Settings; env: Env }>("/api/whatsapp/settings").then((r) => { setS(r.settings); setEnv(r.env); });
  }, []);
  const loadEvents = useCallback(() => api<AgentEvent[]>("/api/whatsapp/agent-events").then(setEvents).catch(() => {}), []);
  useEffect(() => { loadEvents(); }, [loadEvents]);
  useLive((e) => { if (e.type === "agent" || e.type === "poll") loadEvents(); });

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setS((p) => (p ? { ...p, [k]: v } : p)); setDirty(true); };

  const save = async (patch?: Partial<Settings>) => {
    if (!s) return;
    setSaved("saving");
    const r = await api<{ settings: Settings }>("/api/whatsapp/settings", { method: "PUT", json: patch ?? s });
    setS(r.settings);
    if (!patch) setDirty(false);
    setSaved("saved");
    setTimeout(() => setSaved("idle"), 1500);
  };

  // A draft from "Draft from business info": fill the fields, the user reviews and saves.
  const applyDraft = (d: AgentDraft) => {
    setS((p) => (p ? {
      ...p, agentName: d.agentName || p.agentName, businessName: d.businessName || p.businessName, systemPrompt: d.systemPrompt,
      handoffKeywords: d.handoffKeywords.length ? d.handoffKeywords : p.handoffKeywords, handoffMessage: d.handoffMessage || p.handoffMessage,
      leadCriteria: d.leadCriteria || p.leadCriteria,
    } : p));
    setDirty(true);
  };

  if (!s || !env) return <div className="grid h-full place-items-center text-ink-3"><Loader2 className="animate-spin" /></div>;

  const webhook = `${env.publicBaseUrl || "https://YOUR-PUBLIC-URL"}/api/webhooks/twilio`;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{s?.agentName?.trim() || "Freya"}</h1>
            <p className="text-sm text-ink-2">Your AI sales agent: who she is, how she answers your WhatsApp leads, and how they&apos;re qualified.</p>
          </div>
          <button onClick={() => { set("agentEnabled", !s.agentEnabled); save({ agentEnabled: !s.agentEnabled }); }}
            className={`btn ml-auto ${s.agentEnabled ? "" : "btn-primary"}`}>
            {s.agentEnabled ? <><Pause size={16} /> Pause agent everywhere</> : <><Play size={16} /> Resume agent</>}
          </button>
        </div>
        <GoLiveBar />

        <div className={`mb-6 flex items-center gap-3 rounded-2xl px-5 py-4 ${s.agentEnabled ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>
          {s.agentEnabled ? <Bot size={22} /> : <Pause size={22} />}
          <div className="text-sm">
            <b>{s.agentEnabled ? "Agent is live." : "Agent is paused."}</b>{" "}
            {s.agentEnabled
              ? s.agentMode === "n8n"
                ? "Every incoming message is passed to your n8n workflow. Switch a single chat to Manual in the Inbox to handle it yourself."
                : "It replies to every chat where the agent is on. Switch a single chat to Manual in the Inbox to handle it yourself."
              : s.agentMode === "n8n"
                ? "Messages are NOT passed to n8n, so no automatic replies are sent. Incoming messages still appear in the Inbox."
                : "No automatic replies are sent. Incoming messages still appear in the Inbox."}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <Card title="Who replies to customers">
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  { id: "n8n", title: "n8n workflow", desc: "Messages are forwarded to your n8n automation, which replies.", Icon: Workflow },
                  { id: "builtin", title: "Built-in AI agent (Gemini)", desc: "The dashboard answers with Gemini using the settings below.", Icon: Bot },
                ] as const).map(({ id, title, desc, Icon }) => (
                  <button key={id} onClick={() => set("agentMode", id)}
                    className={`flex gap-3 rounded-xl border p-3 text-left transition ${s.agentMode === id ? "border-brand bg-brand-soft" : "border-line hover:bg-panel-2"}`}>
                    <Icon size={20} className="mt-0.5 shrink-0 text-brand" />
                    <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-ink-2">{desc}</span></span>
                  </button>
                ))}
              </div>
              {s.agentMode === "n8n" && (
                <label className="mt-4 block">
                  <span className="mb-1 block text-xs font-medium text-ink-2">n8n webhook URL</span>
                  <input className="input font-mono text-[13px]" value={s.forwardUrl} placeholder="https://…/webhook/…" onChange={(e) => set("forwardUrl", e.target.value.trim())} />
                  <span className="mt-1.5 block text-xs text-ink-3">The dashboard passes Twilio&apos;s original message to this URL, so your workflow works unchanged. Replies n8n sends are pulled from Twilio every 15 seconds.</span>
                </label>
              )}
            </Card>

            <Card title="Your agent" hint="Her name appears on every message she sends in the inbox, and she introduces herself with it.">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ai text-lg font-bold text-white">{(s.agentName || "F").slice(0, 1).toUpperCase()}</span>
                <label className="block flex-1">
                  <span className="mb-1 block text-xs font-medium text-ink-2">Name</span>
                  <input className="input" maxLength={24} value={s.agentName ?? ""} placeholder="Freya" onChange={(e) => set("agentName", e.target.value)} />
                </label>
              </div>
              {s.agentMode === "n8n" && <p className="mt-2 text-xs text-ink-3">Your n8n workflow writes the replies, so use the same name there.</p>}
            </Card>

            {/* The built-in agent always answers Instagram, so these stay visible in n8n mode too. */}
            <>
            <Card title="Persona & instructions" hint={s.agentMode === "n8n"
              ? "WhatsApp replies come from your n8n workflow. This prompt is used for Instagram DMs and ✨ AI drafts. Use {{business}} and {{agent}}."
              : "This is the system prompt. Use {{business}} for your business name and {{agent}} for her name."}>
              <DraftAgentButton onApply={applyDraft} />
              <label className="mb-3 block">
                <span className="mb-1 block text-xs font-medium text-ink-2">Business name</span>
                <input className="input" value={s.businessName} onChange={(e) => set("businessName", e.target.value)} />
              </label>
              <textarea className="input min-h-72 font-mono text-[13px] leading-relaxed" value={s.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />
              <p className="mt-2 text-xs text-ink-3">Tip: paste your FAQs, prices, opening hours and policies here so the agent can answer accurately.</p>
            </Card>

            <Card title="Gemini model">
              <div className="grid gap-2 sm:grid-cols-2">
                {MODELS.map((m) => (
                  <button key={m.id} onClick={() => set("model", m.id)}
                    className={`rounded-xl border p-3 text-left transition ${s.model === m.id ? "border-brand bg-brand-soft" : "border-line hover:bg-panel-2"}`}>
                    <div className="text-sm font-semibold">{m.name}</div>
                    <div className="text-xs text-ink-2">{m.note}</div>
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1 block text-xs font-medium text-ink-2">Thinking (reply depth vs. speed)</span>
                  <select className="input" value={s.effort} onChange={(e) => set("effort", e.target.value as Settings["effort"])}>
                    <option value="low">Low — quickest replies (recommended for chat)</option>
                    <option value="medium">Medium</option>
                    <option value="high">High — most thorough</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-ink-2">Messages of context</span>
                  <input type="number" min={2} max={200} className="input" value={s.historyLimit} onChange={(e) => set("historyLimit", Number(e.target.value))} />
                </label>
              </div>
            </Card>

            </>

            <Card title="Human handoff" hint="When a customer uses one of these words, the chat is flagged for your team, the agent is switched off for it, and the customer gets this message.">
              <span className="mb-1 block text-xs font-medium text-ink-2">Trigger keywords (comma-separated)</span>
              <input className="input" value={s.handoffKeywords.join(", ")} onChange={(e) => set("handoffKeywords", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
              <span className="mb-1 mt-3 block text-xs font-medium text-ink-2">Message sent to the customer on handoff</span>
              <textarea className="input min-h-20" value={s.handoffMessage} onChange={(e) => set("handoffMessage", e.target.value)} />
            </Card>

            <Card title="Lead scoring" hint="After each burst of customer messages, the AI scores the chat 0–100, sets its stage (New → Qualified → Hot), and pulls out email, company, budget and the next step. Gemini also reads the agent's notes and the person's sign-up and purchase records, explains the score, and sets a P1–P4 priority. Runs whether n8n or the built-in agent replies.">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={s.leadScoring} onChange={(e) => set("leadScoring", e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
                <Target size={15} className="text-brand" /> Score leads automatically
              </label>
              {s.leadScoring && (
                <>
                  <span className="mb-1 mt-3 block text-xs font-medium text-ink-2">What a good lead looks like for you</span>
                  <textarea className="input min-h-24" value={s.leadCriteria} onChange={(e) => set("leadCriteria", e.target.value)} />
                  {env.aiConfigured
                    ? <p className="mt-1.5 text-xs text-ok">Scoring with {env.geminiModel ?? "Gemini"}.</p>
                    : <p className="mt-1.5 text-xs text-warn">No GEMINI_API_KEY — using simple keyword rules until a key is added.</p>}
                </>
              )}
            </Card>

            <Card title="Business hours">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={s.businessHoursOnly} onChange={(e) => set("businessHoursOnly", e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
                Only let the agent answer during business hours
              </label>
              {s.businessHoursOnly && (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <label><span className="mb-1 block text-xs text-ink-2">Opens</span><input type="time" className="input" value={s.businessHours.start} onChange={(e) => set("businessHours", { ...s.businessHours, start: e.target.value })} /></label>
                    <label><span className="mb-1 block text-xs text-ink-2">Closes</span><input type="time" className="input" value={s.businessHours.end} onChange={(e) => set("businessHours", { ...s.businessHours, end: e.target.value })} /></label>
                    <label><span className="mb-1 block text-xs text-ink-2">Timezone</span><input className="input" value={s.businessHours.timezone} placeholder="Asia/Karachi" onChange={(e) => set("businessHours", { ...s.businessHours, timezone: e.target.value })} /></label>
                  </div>
                  <span className="mb-1 mt-3 block text-xs font-medium text-ink-2">Out-of-hours reply</span>
                  <textarea className="input min-h-20" value={s.outOfHoursMessage} onChange={(e) => set("outOfHoursMessage", e.target.value)} />
                </>
              )}
            </Card>

            <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-3 bg-gradient-to-t from-bg via-bg px-1 py-4">
              {saved === "saved" && <span className="flex items-center gap-1 text-sm text-brand"><CheckCircle2 size={16} /> Saved</span>}
              <button onClick={() => save()} disabled={!dirty || saved === "saving"} className="btn btn-primary">
                {saved === "saving" ? <Loader2 size={16} className="animate-spin" /> : null} Save changes
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <Card title="Connection">
              <Status ok={env.twilioConfigured} label="Twilio" detail={env.twilioConfigured ? env.whatsappFrom || "Messaging Service" : "Connect in Workspace settings"} />
              {s.agentMode === "n8n"
                ? <Status ok={Boolean(s.forwardUrl)} label="n8n" detail={s.forwardUrl ? hostOf(s.forwardUrl) : "Add the webhook URL"} />
                : <Status ok={env.aiConfigured} label="Gemini API" detail={env.aiConfigured ? "Key loaded" : "Add GEMINI_API_KEY"} />}
              <div className="mt-4">
                <div className="mb-1 text-xs font-medium text-ink-2">Twilio “A message comes in” webhook (HTTP POST)</div>
                <div className="flex items-center gap-2 rounded-lg bg-panel-2 px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs">{webhook}</code>
                  <button onClick={() => navigator.clipboard.writeText(webhook)} className="text-ink-3 hover:text-ink" title="Copy"><Copy size={14} /></button>
                </div>
                <p className="mt-1.5 text-xs text-ink-3">Set this on your WhatsApp sender (or Sandbox settings) in Twilio Console.</p>
              </div>
            </Card>

            <Card title="Live activity">
              <ul className="scroll-thin -mx-1 max-h-[560px] space-y-1 overflow-y-auto">
                {events.map((e) => (
                  <li key={e.id}>
                    <Link href={`/whatsapp?c=${encodeURIComponent(e.conversationId)}`} className="flex gap-3 rounded-lg px-1 py-2 hover:bg-panel-2">
                      <EventIcon type={e.type} />
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{e.conversationId.replace("whatsapp:", "")}</span>
                          <span className="text-ink-3">{timeAgo(e.at)}</span>
                        </div>
                        <p className="line-clamp-2 text-ink-2">{e.detail}</p>
                        {e.latencyMs != null && <p className="mt-0.5 text-ink-3">{(e.latencyMs / 1000).toFixed(1)}s · {(e.inputTokens ?? 0) + (e.outputTokens ?? 0)} tokens</p>}
                      </div>
                    </Link>
                  </li>
                ))}
                {!events.length && <li className="py-8 text-center text-sm text-ink-3">No agent activity yet.</li>}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-ink-2">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

function Status({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-brand" : "bg-warn"}`} />
      <span className="font-medium">{label}</span>
      <span className="ml-auto truncate text-xs text-ink-2">{detail}</span>
    </div>
  );
}

function EventIcon({ type }: { type: AgentEvent["type"] }) {
  const map = {
    reply: { Icon: Bot, cls: "bg-ai-soft text-ai" },
    forwarded: { Icon: Forward, cls: "bg-ai-soft text-ai" },
    handoff: { Icon: Hand, cls: "bg-warn-soft text-warn" },
    skipped: { Icon: SkipForward, cls: "bg-panel-2 text-ink-3" },
    error: { Icon: AlertCircle, cls: "bg-danger-soft text-danger" },
  }[type];
  return <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${map.cls}`}><map.Icon size={14} /></span>;
}

function hostOf(url: string) {
  try { return new URL(url).host; } catch { return "Invalid URL"; }
}
