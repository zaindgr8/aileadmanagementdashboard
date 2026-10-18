"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Shuffle, Sparkles, UserPlus, Users, X } from "lucide-react";
import { api, useLive } from "@/lib/whatsapp/client";
import { Avatar } from "@/components/whatsapp/ui";
import type { Agent, AssignmentSettings, Settings } from "@/lib/whatsapp/types";
import type { SessionUser } from "@/lib/auth/modules";

type Scoring = { gemini: boolean; model: string | null; running: boolean; total: number; done: number; failed: number; lastError?: string };

const MODES: { id: AssignmentSettings["mode"]; title: string; desc: string }[] = [
  { id: "off", title: "Manual", desc: "Nobody is assigned automatically. Teammates pick chats themselves." },
  { id: "round_robin", title: "Round-robin", desc: "New chats go to each available teammate in turn." },
  { id: "least_busy", title: "Least busy", desc: "New chats go to whoever has the fewest open chats." },
];

export default function TeamPage() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [rules, setRules] = useState<AssignmentSettings | null>(null);
  const [scoring, setScoring] = useState<Scoring | null>(null);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => api<Agent[]>("/api/whatsapp/team").then(setAgents).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    api<SessionUser>("/api/me").then(setMe).catch(() => {});
    api<{ settings: Settings }>("/api/whatsapp/settings").then((r) => setRules(r.settings.assignment)).catch(() => {});
    api<Scoring>("/api/whatsapp/scoring").then(setScoring).catch(() => {});
  }, [load]);
  useLive((e) => { if (e.type === "team" || e.type === "conversation") load(); });

  const manager = me?.role === "owner" || me?.role === "admin";

  const saveRules = async (patch: Partial<AssignmentSettings>) => {
    if (!rules) return;
    const next = { ...rules, ...patch };
    setRules(next);
    const r = await api<{ settings: Settings }>("/api/whatsapp/settings", { method: "PUT", json: { assignment: next } }).catch((e) => { setError(e.message); return null; });
    if (r) { setRules(r.settings.assignment); setSaved(true); setTimeout(() => setSaved(false), 1500); }
  };

  const updateAgent = async (username: string, patch: Partial<{ available: boolean; active: boolean; role: Agent["role"] }>) => {
    setAgents((as) => as?.map((a) => (a.username === username ? { ...a, ...patch } : a)) ?? as);
    try { setAgents(await api<Agent[]>(`/api/whatsapp/team/${encodeURIComponent(username)}`, { method: "PATCH", json: patch })); }
    catch (e) { setError((e as Error).message); load(); }
  };

  const rescoreAll = async () => {
    try { setScoring(await api<Scoring>("/api/whatsapp/scoring", { method: "POST" })); } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    if (!scoring?.running) return;
    const t = setInterval(() => api<Scoring>("/api/whatsapp/scoring").then(setScoring).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [scoring?.running]);

  if (!agents || !rules) return <div className="grid h-full place-items-center text-ink-3"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
            <p className="text-sm text-ink-2">Who works the WhatsApp inbox, and how new chats are shared out.</p>
          </div>
          {manager && <button onClick={() => setAdding(true)} className="btn btn-primary ml-auto"><UserPlus size={16} /> Add teammate</button>}
        </div>

        {error && <div className="mb-4 flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"><span className="flex-1">{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}

        <section className="card mb-6 overflow-hidden">
          <header className="flex items-center gap-2 border-b border-line px-5 py-3.5"><Users size={16} className="text-brand" /><h2 className="font-semibold">Teammates</h2><span className="text-xs text-ink-3">{agents.filter((a) => a.active).length} active</span></header>
          <ul>
            {agents.map((a) => (
              <li key={a.username} className={`flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-0 ${a.active ? "" : "opacity-50"}`}>
                <span className="relative"><Avatar name={a.name} size={36} /><span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel ${a.active && a.available ? "bg-ok" : "bg-ink-3"}`} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate font-medium">{a.name}</span>{a.username === me?.username && <span className="text-xs text-ink-3">(you)</span>}</div>
                  <div className="text-xs text-ink-3">@{a.username} · <span className="capitalize">{a.role}</span> · {a.open} open {a.open === 1 ? "chat" : "chats"}</div>
                </div>
                {a.active && (manager || a.username === me?.username) && (
                  <button onClick={() => updateAgent(a.username, { available: !a.available })}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${a.available ? "bg-ok-soft text-ok" : "bg-panel-2 text-ink-3"}`}
                    title="Away teammates aren't auto-assigned new chats">
                    {a.available ? "Available" : "Away"}
                  </button>
                )}
                {manager && a.role !== "owner" && a.username !== me?.username && (
                  <>
                    {me?.role === "owner" && a.active && (
                      <select className="input w-auto py-1 text-xs" value={a.role} onChange={(e) => updateAgent(a.username, { role: e.target.value as Agent["role"] })}>
                        <option value="member">Agent</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                    <button onClick={() => updateAgent(a.username, { active: !a.active })} className="btn px-2.5 py-1 text-xs">
                      {a.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {agents.length <= 1 && <p className="px-5 py-4 text-sm text-ink-3">It&apos;s just you for now. Add teammates so chats can be shared out and assigned.</p>}
        </section>

        <section className="card mb-6 p-5">
          <div className="mb-1 flex items-center gap-2"><Shuffle size={16} className="text-brand" /><h2 className="font-semibold">Auto-assignment</h2>{saved && <span className="flex items-center gap-1 text-xs text-ok"><CheckCircle2 size={13} /> Saved</span>}</div>
          <p className="mb-4 text-sm text-ink-2">When a customer messages and the chat has no owner yet.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button key={m.id} disabled={!manager} onClick={() => saveRules({ mode: m.id })}
                className={`rounded-xl border p-3 text-left transition disabled:cursor-default ${rules.mode === m.id ? "border-brand bg-brand-soft" : "border-line hover:bg-panel-2"}`}>
                <div className="text-sm font-semibold">{m.title}</div>
                <div className="text-xs text-ink-2">{m.desc}</div>
              </button>
            ))}
          </div>
          {rules.mode !== "off" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-ink-2">Which chats</span>
                <select className="input" disabled={!manager} value={rules.when} onChange={(e) => saveRules({ when: e.target.value as AssignmentSettings["when"] })}>
                  <option value="all">Every new chat</option>
                  <option value="qualified">Only qualified leads (P1/P2) — the AI handles the rest</option>
                  <option value="hot">Only hot leads (P1)</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-ink-2">Max open chats per teammate</span>
                <input type="number" min={0} className="input" disabled={!manager} value={rules.capacity} onChange={(e) => setRules({ ...rules, capacity: Math.max(0, Number(e.target.value) || 0) })}
                  onBlur={() => saveRules({ capacity: rules.capacity })} />
                <span className="mt-1 block text-xs text-ink-3">0 = no limit. Full teammates are skipped.</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={!manager} checked={rules.onlyAvailable} onChange={(e) => saveRules({ onlyAvailable: e.target.checked })} /> Skip teammates who are set to Away
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={!manager} checked={rules.unassignOnResolve} onChange={(e) => saveRules({ unassignOnResolve: e.target.checked })} /> Unassign a chat when it&apos;s resolved
              </label>
            </div>
          )}
        </section>

        <section className="card p-5">
          <div className="mb-1 flex items-center gap-2"><Sparkles size={16} className="text-ai" /><h2 className="font-semibold">AI lead scoring</h2></div>
          {scoring?.gemini ? (
            <>
              <p className="mb-3 text-sm text-ink-2">
                Every chat is scored by <b>Gemini</b> ({scoring.model}) using the conversation, the WhatsApp agent&apos;s notes and the person&apos;s sign-up and purchase records: a 0–100 score with reasons, priority P1–P4, urgency, mood, language, tags and the next best step.
              </p>
              {scoring.running ? (
                <div className="flex items-center gap-2 text-sm text-ai"><Loader2 size={15} className="animate-spin" /> Scoring {scoring.done}/{scoring.total}…</div>
              ) : manager && (
                <button onClick={rescoreAll} className="btn text-sm"><Sparkles size={15} /> Re-score all chats now</button>
              )}
              {scoring.failed > 0 && <p className="mt-2 text-xs text-danger">{scoring.failed} failed{scoring.lastError ? `: ${scoring.lastError}` : ""}</p>}
            </>
          ) : (
            <p className="text-sm text-ink-2">
              Gemini isn&apos;t connected yet, so chats are scored with simple keyword rules. Add <code className="rounded bg-panel-2 px-1">GEMINI_API_KEY</code> to <code className="rounded bg-panel-2 px-1">.env.local</code> and restart the app — every chat is then re-scored automatically.
            </p>
          )}
        </section>
      </div>

      {adding && <AddTeammate isOwner={me?.role === "owner"} onClose={() => setAdding(false)} onAdded={(list) => { setAgents(list); setAdding(false); }} />}
    </div>
  );
}

function AddTeammate({ isOwner, onClose, onAdded }: { isOwner: boolean; onClose: () => void; onAdded: (a: Agent[]) => void }) {
  const [f, setF] = useState({ name: "", username: "", password: "", role: "member" as Agent["role"], calls: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { onAdded(await api<Agent[]>("/api/whatsapp/team", { method: "POST", json: f })); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <div data-modal className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4 backdrop-blur-[2px]" onClick={onClose}>
      <form onSubmit={submit} className="card anim-pop w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-semibold">Add teammate</h3><button type="button" onClick={onClose} className="text-ink-3"><X size={18} /></button></div>
        <div className="space-y-3">
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-ink-2">Name</span><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sara Khan" /></label>
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-ink-2">Username (for signing in and @mentions)</span><input className="input" required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "") })} placeholder="sara" /></label>
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-ink-2">Temporary password (min 8 characters)</span><input className="input" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          {isOwner && (
            <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-ink-2">Role</span>
              <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Agent["role"] })}>
                <option value="member">Agent — works chats</option>
                <option value="admin">Admin — also manages the team and settings</option>
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.calls} onChange={(e) => setF({ ...f, calls: e.target.checked })} /> Also give access to Voice calls</label>
        </div>
        {err && <p className="mt-3 text-sm text-danger">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn">Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />} Add teammate</button>
        </div>
        <p className="mt-3 text-xs text-ink-3">Share the username and password with them privately; they sign in at this same address.</p>
      </form>
    </div>
  );
}
