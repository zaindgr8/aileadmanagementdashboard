"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, Loader2, MessageCircleHeart, Plus, ShieldCheck, Trash2, Unplug } from "lucide-react";
import { api } from "@/lib/whatsapp/client";
import type { InstagramAccount } from "@/lib/tenant/types";
import type { CommentRule, Settings } from "@/lib/whatsapp/types";

type Status = {
  appConfigured: boolean;
  account: InstagramAccount | null;
  setup?: { callbackUrl: string; verifyToken: string; redirectUri: string; httpsOk: boolean };
  daysLeft?: number | null;
};

function InstagramGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
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

const newRule = (): CommentRule => ({ id: crypto.randomUUID(), enabled: true, keywords: [], dm: "", publicReply: "" });

/** Instagram on the Connections page: one-click connect, status, and comment-to-DM rules. */
export default function InstagramCard({ canManage }: { canManage: boolean }) {
  const [s, setS] = useState<Status | null>(null);
  const [rules, setRules] = useState<CommentRule[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api<Status>("/api/instagram")
      .then((r) => setS({ ...r, daysLeft: r.account?.tokenExpiresAt ? Math.round((new Date(r.account.tokenExpiresAt).getTime() - Date.now()) / 86_400_000) : null }))
      .catch((e) => setErr(e.message));
    api<{ settings: Settings }>("/api/whatsapp/settings").then((r) => setRules(r.settings.instagramRules ?? [])).catch(() => setRules([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const disconnect = async () => {
    if (!confirm("Disconnect Instagram? New DMs and comments stop arriving until you connect again.")) return;
    setBusy(true);
    try { await api("/api/instagram", { method: "DELETE" }); load(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const saveRules = async () => {
    setBusy(true); setErr("");
    try {
      const clean = (rules ?? []).map((r) => ({ ...r, keywords: r.keywords.map((k) => k.trim()).filter(Boolean), dm: r.dm.trim(), publicReply: r.publicReply?.trim() || undefined }));
      const r = await api<{ settings: Settings }>("/api/whatsapp/settings", { method: "PUT", json: { instagramRules: clean } });
      setRules(r.settings.instagramRules);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const setRule = (id: string, patch: Partial<CommentRule>) => setRules((rs) => rs?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? rs);

  const acc = s?.account;
  const daysLeft = s?.daysLeft ?? null;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: "linear-gradient(45deg,#f9a825,#e1306c 45%,#833ab4)" }}><InstagramGlyph /></span>
        <div className="min-w-0 flex-1 leading-tight"><h2 className="font-semibold">Instagram</h2><p className="text-xs text-ink-3">DMs, story replies and comment-to-DM, in the same inbox. Freya answers here too.</p></div>
        {acc
          ? <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ok-soft px-2.5 text-xs font-medium text-ok"><CheckCircle2 size={13} />Connected</span>
          : <span className="inline-flex h-6 items-center rounded-full bg-warn-soft px-2.5 text-xs font-medium text-warn">Not connected</span>}
      </header>

      <div className="space-y-4 p-5">
        {err && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
        {!s ? <div className="grid h-16 place-items-center text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
          : !s.appConfigured ? (
            <p className="flex items-start gap-2 rounded-xl bg-panel-2 px-3.5 py-3 text-sm text-ink-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
              {s.setup ? "The Instagram app isn't set up on the server yet. Add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to the environment and restart." : "Instagram is coming soon for your workspace."}
            </p>
          ) : acc ? (
            <div className="flex flex-wrap items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {acc.picture ? <img src={acc.picture} alt="" className="h-12 w-12 rounded-full object-cover" /> : <span className="grid h-12 w-12 place-items-center rounded-full bg-panel-2 text-ink-3"><InstagramGlyph size={22} /></span>}
              <div className="min-w-0 flex-1 leading-tight">
                <div className="font-semibold">@{acc.username}</div>
                <div className="text-xs text-ink-3">{acc.name ? `${acc.name} · ` : ""}connected {new Date(acc.connectedAt).toLocaleDateString()}{acc.connectedBy ? ` by ${acc.connectedBy}` : ""}{daysLeft !== null ? ` · access renews automatically (${daysLeft} days left)` : ""}</div>
              </div>
              {canManage && <button className="btn" disabled={busy} onClick={disconnect}><Unplug size={15} />Disconnect</button>}
            </div>
          ) : (
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
                <li>Your Instagram must be a <b className="text-ink">Professional</b> account (Settings → Account type and tools).</li>
                <li>In Instagram: Settings → Messages and story replies → Message controls → turn on <b className="text-ink">Allow access to messages</b>.</li>
                <li>Click Connect, log in to Instagram and press <b className="text-ink">Allow</b>.</li>
              </ol>
              {canManage
                ? <a href="/api/instagram/connect" className="btn btn-primary inline-flex"><InstagramGlyph size={16} />Connect Instagram</a>
                : <p className="text-xs text-ink-3">Ask your workspace owner or an admin to connect Instagram.</p>}
            </div>
          )}

        {acc && rules && (
          <div className="rounded-2xl border border-line p-4">
            <div className="mb-1 flex items-center gap-2">
              <MessageCircleHeart size={16} className="text-brand" />
              <h3 className="text-sm font-semibold">Comment → DM</h3>
              {canManage && <button className="btn ml-auto h-8 px-3 text-xs" onClick={() => setRules((r) => [...(r ?? []), newRule()])}><Plus size={14} />Add rule</button>}
            </div>
            <p className="mb-3 text-xs text-ink-3">When someone comments a keyword on any post or reel, they get a DM automatically and Freya takes the conversation from there. Instagram allows one DM per comment.</p>
            {!rules.length && <p className="rounded-xl bg-panel-2 px-3 py-3 text-xs text-ink-3">No rules yet. Example: keyword <b>SIXTY</b> → DM “Here’s the demo link you asked for…”.</p>}
            <div className="space-y-3">
              {rules.map((r) => (
                <div key={r.id} className={`rounded-xl border border-line p-3 ${r.enabled ? "" : "opacity-60"}`}>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-ink-2">Keywords (comma separated; empty = every comment)</span>
                      <input className="input" disabled={!canManage} value={r.keywords.join(", ")} placeholder="SIXTY, demo, price"
                        onChange={(e) => setRule(r.id, { keywords: e.target.value.split(",") })} />
                    </label>
                    <div className="flex items-end gap-2">
                      <label className="flex h-10 items-center gap-2 text-xs"><input type="checkbox" disabled={!canManage} checked={r.enabled} onChange={(e) => setRule(r.id, { enabled: e.target.checked })} />On</label>
                      {canManage && <button className="btn h-10 px-2.5 text-ink-3 hover:text-danger" title="Delete rule" onClick={() => setRules((rs) => rs?.filter((x) => x.id !== r.id) ?? rs)}><Trash2 size={15} /></button>}
                    </div>
                  </div>
                  <label className="mt-2 block">
                    <span className="mb-1 block text-[11px] font-medium text-ink-2">DM they receive</span>
                    <textarea className="input min-h-16" disabled={!canManage} value={r.dm} maxLength={1000} placeholder="Hey! Thanks for the comment. Here's what you asked for: … What's your business, by the way?"
                      onChange={(e) => setRule(r.id, { dm: e.target.value })} />
                  </label>
                  <label className="mt-2 block">
                    <span className="mb-1 block text-[11px] font-medium text-ink-2">Public reply under their comment (optional)</span>
                    <input className="input" disabled={!canManage} value={r.publicReply ?? ""} placeholder="Sent you a DM 📩" onChange={(e) => setRule(r.id, { publicReply: e.target.value })} />
                  </label>
                </div>
              ))}
            </div>
            {canManage && rules.length > 0 && (
              <div className="mt-3 flex justify-end">
                <button className="btn btn-primary" disabled={busy} onClick={saveRules}>{busy ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}{saved ? "Saved" : "Save rules"}</button>
              </div>
            )}
          </div>
        )}

        {s?.setup && (
          <details className="rounded-2xl border border-dashed border-line px-4 py-3 text-sm">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-2"><ShieldCheck size={14} />Platform setup (admins only, done once in the Meta app)</summary>
            <div className="mt-3 space-y-3">
              {!s.setup.httpsOk && <p className="text-xs text-warn">Meta needs a public https address. Deploy the app (and set PUBLIC_BASE_URL) or use an ngrok URL, then open this page from that address.</p>}
              <CopyRow label="Meta app → Instagram → API setup with Instagram login → Business login settings → OAuth redirect URI" value={s.setup.redirectUri} />
              <CopyRow label="Meta app → Instagram → Webhooks → Callback URL" value={s.setup.callbackUrl} />
              <CopyRow label="Webhooks → Verify token" value={s.setup.verifyToken} />
              <p className="text-[11px] text-ink-3">Then subscribe to the fields: messages, messaging_postbacks, comments.</p>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
