"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Building2, Check, CheckCircle2, Copy, KeyRound, Link2, Loader2, MessageCircle, PhoneCall, Plug, Trash2, UserPlus, Users, X, Zap,
} from "lucide-react";
import { api } from "@/lib/whatsapp/client";
import type { Invite, WorkspaceInfo } from "@/lib/tenant/types";
import type { ModuleKey } from "@/lib/auth/modules";

type Source = "workspace" | "env" | null;
type View = {
  workspace: WorkspaceInfo;
  sources: Record<"twilioAccountSid" | "twilioAuthToken" | "twilioFrom" | "twilioMessagingServiceSid" | "retellApiKey" | "retellAgentIds", Source>;
  webhooks: { inbound: string; status: string; publicBaseUrlSet: boolean };
  users: { username: string; display_name: string; email: string | null; role: string; modules: string[]; active: boolean; last_login_at: string | null }[];
  invites: Invite[];
  canManage: boolean;
};

const TABS = [
  { id: "connections", label: "Connections", icon: Plug },
  { id: "people", label: "People & invites", icon: Users },
  { id: "general", label: "General", icon: Building2 },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function WorkspaceSettings() {
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("connections");
  const load = useCallback(() => api<View>("/api/workspace").then(setV).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (!v) return <div className="grid h-full place-items-center text-ink-3">{error ? <p className="text-sm text-danger">{error}</p> : <Loader2 className="animate-spin" />}</div>;
  const w = v.workspace;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
          <p className="text-sm text-ink-2">{w.name}: the accounts this workspace uses, and who can sign in to it.</p>
        </div>

        <div className="mb-5 flex gap-1 rounded-xl bg-panel-2 p-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex h-9 flex-1 items-center justify-center gap-2 rounded-lg text-[13px] font-medium ${tab === t.id ? "bg-panel shadow-sm" : "text-ink-2 hover:text-ink"}`}>
              <t.icon size={15} />{t.label}
            </button>
          ))}
        </div>

        {error && <div className="mb-4 flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"><span className="flex-1">{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
        {!v.canManage && <p className="mb-4 rounded-xl bg-info-soft px-4 py-3 text-sm text-info">Only the workspace owner and admins can change these settings.</p>}

        {tab === "connections" && <Connections v={v} onSaved={setV} />}
        {tab === "people" && <People v={v} reload={load} />}
        {tab === "general" && <General v={v} onSaved={setV} />}
      </div>
    </div>
  );
}

function SourceTag({ s }: { s: Source }) {
  if (s === "workspace") return <span className="rounded-md bg-ok-soft px-1.5 py-0.5 text-[10px] font-semibold text-ok">SAVED</span>;
  if (s === "env") return <span className="rounded-md bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold text-info" title="Coming from .env.local on the server">FROM .ENV</span>;
  return null;
}

function Field({ label, hint, source, children }: { label: string; hint?: string; source?: Source; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-2 text-xs font-medium text-ink-2">{label}{source !== undefined && <SourceTag s={source} />}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}

function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-ink-3">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-panel-2 p-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{value}</span>
        <button type="button" className="btn h-7 px-2.5 text-xs" onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

function useTest() {
  const [state, setState] = useState<{ busy: boolean; ok?: boolean; msg?: string }>({ busy: false });
  const run = async (json: Record<string, unknown>) => {
    setState({ busy: true });
    try {
      const r = await api<{ detail: string }>("/api/workspace/test", { method: "POST", json });
      setState({ busy: false, ok: true, msg: r.detail });
    } catch (e) { setState({ busy: false, ok: false, msg: (e as Error).message }); }
  };
  return [state, run] as const;
}

function Connections({ v, onSaved }: { v: View; onSaved: (v: View) => void }) {
  const w = v.workspace;
  const wa = w.modules.includes("whatsapp");
  const calls = w.modules.includes("calls");
  const [tw, setTw] = useState({
    twilioAccountSid: w.config.twilioAccountSid ?? "", twilioAuthToken: "",
    twilioFrom: (w.config.twilioFrom ?? "").replace(/^whatsapp:/, ""), twilioMessagingServiceSid: w.config.twilioMessagingServiceSid ?? "",
  });
  const [rt, setRt] = useState({ retellApiKey: "", retellAgentIds: (w.config.retellAgentIds ?? []).join(", ") });
  const [saving, setSaving] = useState<"" | "twilio" | "retell">("");
  const [saved, setSaved] = useState<"" | "twilio" | "retell">("");
  const [err, setErr] = useState("");
  const [twTest, testTw] = useTest();
  const [rtTest, testRt] = useTest();
  const ro = !v.canManage;

  const save = async (kind: "twilio" | "retell", json: Record<string, unknown>) => {
    setSaving(kind); setErr("");
    try {
      onSaved(await api<View>("/api/workspace", { method: "PATCH", json }));
      setSaved(kind); setTimeout(() => setSaved(""), 2000);
      if (kind === "twilio") setTw((x) => ({ ...x, twilioAuthToken: "" }));
      else setRt((x) => ({ ...x, retellApiKey: "" }));
    } catch (e) { setErr((e as Error).message); }
    setSaving("");
  };
  // Only send the secret when something was typed, so saving other fields keeps the stored one.
  const twBody = () => ({ ...tw, twilioAuthToken: tw.twilioAuthToken || undefined });
  const twConnected = Boolean((v.sources.twilioAccountSid && v.sources.twilioAuthToken) && (v.sources.twilioFrom || v.sources.twilioMessagingServiceSid));
  const rtConnected = Boolean(v.sources.retellApiKey);

  return (
    <div className="space-y-6">
      {err && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{err}</p>}

      {wa && (
        <section className="card overflow-hidden">
          <header className="flex items-center gap-3 border-b border-line px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#25D366]/15 text-[#128C7E]"><MessageCircle size={18} /></span>
            <div className="min-w-0 flex-1 leading-tight"><h2 className="font-semibold">WhatsApp (Twilio)</h2><p className="text-xs text-ink-3">The number your customers message. Each workspace uses its own Twilio account.</p></div>
            <Status ok={twConnected} />
          </header>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field label="Account SID" source={v.sources.twilioAccountSid} hint="Twilio Console → Account info. Starts with AC.">
              <input className="input font-mono text-xs" disabled={ro} value={tw.twilioAccountSid} onChange={(e) => setTw({ ...tw, twilioAccountSid: e.target.value.trim() })} placeholder="AC…" autoComplete="off" />
            </Field>
            <Field label="Auth token" source={v.sources.twilioAuthToken} hint={v.sources.twilioAuthToken ? "Saved and hidden. Type a new one to replace it." : "Twilio Console → Account info."}>
              <input className="input font-mono text-xs" type="password" disabled={ro} value={tw.twilioAuthToken} onChange={(e) => setTw({ ...tw, twilioAuthToken: e.target.value.trim() })}
                placeholder={v.sources.twilioAuthToken ? "•••••••••••••••• (saved)" : "32 characters"} autoComplete="new-password" />
            </Field>
            <Field label="WhatsApp sender number" source={v.sources.twilioFrom} hint="Your approved WhatsApp number, e.g. +971501234567.">
              <input className="input font-mono text-xs" disabled={ro} value={tw.twilioFrom} onChange={(e) => setTw({ ...tw, twilioFrom: e.target.value })} placeholder="+14155238886" />
            </Field>
            <Field label="Messaging Service SID (optional)" source={v.sources.twilioMessagingServiceSid} hint="Use instead of a single number. Starts with MG.">
              <input className="input font-mono text-xs" disabled={ro} value={tw.twilioMessagingServiceSid} onChange={(e) => setTw({ ...tw, twilioMessagingServiceSid: e.target.value.trim() })} placeholder="MG…" />
            </Field>
          </div>
          <div className="space-y-3 border-t border-line bg-panel-2/40 px-5 py-4">
            <p className="text-xs font-medium text-ink-2">In Twilio, set your WhatsApp sender&apos;s webhooks to:</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Copyable label="When a message comes in (POST)" value={v.webhooks.inbound} />
              <Copyable label="Status callback URL" value={v.webhooks.status} />
            </div>
            {!v.webhooks.publicBaseUrlSet && <p className="text-[11px] text-warn">These use the address you&apos;re on now. Once the app is deployed, set PUBLIC_BASE_URL so they point at the public address.</p>}
          </div>
          {!ro && (
            <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
              <TestResult t={twTest} />
              <button className="btn ml-auto" disabled={twTest.busy} onClick={() => testTw({ kind: "twilio", ...tw })}>{twTest.busy ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}Test connection</button>
              <button className="btn btn-primary" disabled={saving === "twilio"} onClick={() => save("twilio", twBody())}>
                {saving === "twilio" ? <Loader2 size={15} className="animate-spin" /> : saved === "twilio" ? <Check size={15} /> : <KeyRound size={15} />}{saved === "twilio" ? "Saved" : "Save"}
              </button>
            </footer>
          )}
        </section>
      )}

      {calls && (
        <section className="card overflow-hidden">
          <header className="flex items-center gap-3 border-b border-line px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand"><PhoneCall size={18} /></span>
            <div className="min-w-0 flex-1 leading-tight"><h2 className="font-semibold">Voice calls (Retell)</h2><p className="text-xs text-ink-3">The Retell account whose agents and numbers this workspace calls with.</p></div>
            <Status ok={rtConnected} />
          </header>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field label="Retell API key" source={v.sources.retellApiKey} hint={v.sources.retellApiKey ? "Saved and hidden. Type a new one to replace it." : "Retell dashboard → Settings → API keys."}>
              <input className="input font-mono text-xs" type="password" disabled={ro} value={rt.retellApiKey} onChange={(e) => setRt({ ...rt, retellApiKey: e.target.value.trim() })}
                placeholder={v.sources.retellApiKey ? "•••••••••••••••• (saved)" : "key_…"} autoComplete="new-password" />
            </Field>
            <Field label="Allowed agents (optional)" source={v.sources.retellAgentIds} hint="Leave empty to allow every agent on the account. Separate IDs with commas.">
              <input className="input font-mono text-xs" disabled={ro} value={rt.retellAgentIds} onChange={(e) => setRt({ ...rt, retellAgentIds: e.target.value })} placeholder="agent_…, agent_…" />
            </Field>
          </div>
          {!ro && (
            <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
              <TestResult t={rtTest} />
              <button className="btn ml-auto" disabled={rtTest.busy} onClick={() => testRt({ kind: "retell", retellApiKey: rt.retellApiKey })}>{rtTest.busy ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}Test connection</button>
              <button className="btn btn-primary" disabled={saving === "retell"} onClick={() => save("retell", { retellAgentIds: rt.retellAgentIds, ...(rt.retellApiKey ? { retellApiKey: rt.retellApiKey } : {}) })}>
                {saving === "retell" ? <Loader2 size={15} className="animate-spin" /> : saved === "retell" ? <Check size={15} /> : <KeyRound size={15} />}{saved === "retell" ? "Saved" : "Save"}
              </button>
            </footer>
          )}
        </section>
      )}

      <p className="flex items-center gap-2 px-1 text-xs text-ink-3"><KeyRound size={13} />Keys are encrypted before they&apos;re stored and never shown again after saving.</p>
    </div>
  );
}

function Status({ ok }: { ok: boolean }) {
  return ok
    ? <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ok-soft px-2.5 text-xs font-medium text-ok"><CheckCircle2 size={13} />Connected</span>
    : <span className="inline-flex h-6 items-center rounded-full bg-warn-soft px-2.5 text-xs font-medium text-warn">Not connected</span>;
}

function TestResult({ t }: { t: { ok?: boolean; msg?: string } }) {
  if (!t.msg) return null;
  return <span className={`text-xs ${t.ok ? "text-ok" : "text-danger"}`}>{t.ok ? "✓ " : ""}{t.msg}</span>;
}

function People({ v, reload }: { v: View; reload: () => void }) {
  const w = v.workspace;
  const [f, setF] = useState({ email: "", name: "", role: "member", modules: ["whatsapp"] as ModuleKey[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setLink("");
    try {
      const r = await api<{ link: string }>("/api/workspace/invites", { method: "POST", json: f });
      setLink(r.link);
      setF({ ...f, email: "", name: "" });
      reload();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const revoke = async (id: string) => {
    try { await api(`/api/workspace/invites?id=${encodeURIComponent(id)}`, { method: "DELETE" }); reload(); } catch (x) { setErr((x as Error).message); }
  };

  return (
    <div className="space-y-6">
      {v.canManage && (
        <form onSubmit={invite} className="card p-5">
          <h2 className="mb-1 flex items-center gap-2 font-semibold"><UserPlus size={16} className="text-brand" />Invite a teammate</h2>
          <p className="mb-4 text-xs text-ink-3">They get a one-time link (valid 7 days) to choose their own username and password.</p>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_170px]">
            <input className="input" type="email" placeholder="Email (optional)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <input className="input" placeholder="Name (optional)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="member">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {w.modules.map((m) => {
              const on = f.modules.includes(m);
              return (
                <button type="button" key={m} onClick={() => setF({ ...f, modules: on ? f.modules.filter((x) => x !== m) : [...f.modules, m] })}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium ${on ? "border-brand bg-brand/5 text-ink" : "border-line text-ink-3"}`}>
                  {m === "whatsapp" ? <MessageCircle size={13} /> : <PhoneCall size={13} />}{m === "whatsapp" ? "WhatsApp" : "Voice calls"}{on && <Check size={12} />}
                </button>
              );
            })}
            <button className="btn btn-primary ml-auto" disabled={busy || !f.modules.length}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}Create invite link</button>
          </div>
          {err && <p className="mt-3 text-sm text-danger">{err}</p>}
          {link && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-ok/30 bg-ok-soft/50 p-1.5 pl-3">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{link}</span>
              <button type="button" className="btn h-8 px-3 text-xs" onClick={() => { void navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? <><Check size={13} />Copied</> : <><Copy size={13} />Copy link</>}
              </button>
            </div>
          )}
        </form>
      )}

      {v.invites.length > 0 && (
        <section className="card overflow-hidden">
          <header className="border-b border-line px-5 py-3"><h2 className="text-sm font-semibold">Pending invites</h2></header>
          <ul>
            {v.invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 border-b border-line px-5 py-3 text-sm last:border-0">
                <span className="min-w-0 flex-1 leading-tight"><span className="block truncate font-medium">{i.email || i.name || "Open invite"}</span><span className="text-xs text-ink-3">expires {new Date(i.expiresAt).toLocaleDateString()} · by {i.createdBy}</span></span>
                <span className="rounded-md bg-panel-2 px-2 py-0.5 text-xs capitalize">{i.role === "member" ? "agent" : i.role}</span>
                {v.canManage && <button onClick={() => revoke(i.id)} className="rounded-lg p-1.5 text-ink-3 hover:bg-panel-2 hover:text-danger" title="Revoke"><Trash2 size={15} /></button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-line px-5 py-3"><Users size={15} className="text-brand" /><h2 className="text-sm font-semibold">Members</h2><span className="text-xs text-ink-3">{v.users.filter((u) => u.active).length} active</span></header>
        <ul>
          {v.users.map((u) => (
            <li key={u.username} className={`flex items-center gap-3 border-b border-line px-5 py-3 text-sm last:border-0 ${u.active ? "" : "opacity-50"}`}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{(u.display_name || u.username).slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1 leading-tight"><span className="block truncate font-medium">{u.display_name || u.username}</span><span className="block truncate text-xs text-ink-3">{u.username}{u.email ? ` · ${u.email}` : ""}</span></span>
              <span className="hidden text-xs text-ink-3 md:block">{u.modules.map((m) => (m === "whatsapp" ? "WhatsApp" : "Voice")).join(" · ")}</span>
              <span className="rounded-md bg-panel-2 px-2 py-0.5 text-xs capitalize">{u.role === "member" ? "agent" : u.role}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-5 py-3 text-xs text-ink-3">Change roles, availability or deactivate people on WhatsApp → Team.</p>
      </section>
    </div>
  );
}

function General({ v, onSaved }: { v: View; onSaved: (v: View) => void }) {
  const w = v.workspace;
  const [name, setName] = useState(w.name);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const save = async () => {
    setBusy(true); setMsg("");
    try { onSaved(await api<View>("/api/workspace", { method: "PATCH", json: { name } })); setMsg("Saved. Sign out and in again to see the new name everywhere."); }
    catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  return (
    <section className="card space-y-4 p-5">
      <Field label="Workspace name">
        <div className="flex gap-2">
          <input className="input" disabled={!v.canManage} value={name} onChange={(e) => setName(e.target.value)} />
          {v.canManage && <button className="btn btn-primary" disabled={busy || name.trim() === w.name || name.trim().length < 2} onClick={save}>{busy && <Loader2 size={15} className="animate-spin" />}Save</button>}
        </div>
      </Field>
      {msg && <p className="text-xs text-ink-2">{msg}</p>}
      <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
        <dt className="text-ink-3">Workspace ID</dt><dd className="font-mono text-xs">{w.id}</dd>
        <dt className="text-ink-3">Plan</dt><dd className="capitalize">{w.plan}</dd>
        <dt className="text-ink-3">Modules</dt><dd>{w.modules.map((m) => (m === "whatsapp" ? "WhatsApp" : "Voice calls")).join(", ")}</dd>
        <dt className="text-ink-3">Created</dt><dd>{new Date(w.createdAt).toLocaleDateString()}</dd>
      </dl>
      <p className="text-xs text-ink-3">To change your plan or add a module, contact DevMate Solutions.</p>
    </section>
  );
}
