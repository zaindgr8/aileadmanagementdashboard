"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, Loader2, MessageCircle, ShieldCheck, Unplug } from "lucide-react";
import { api } from "@/lib/whatsapp/client";
import type { WhatsAppCloudAccount } from "@/lib/tenant/types";
import ConnectWhatsApp from "./ConnectWhatsApp";

type Status = {
  appConfigured: boolean;
  signup: { appId: string; configId: string; version: string } | null;
  account: WhatsAppCloudAccount | null;
  setup?: { callbackUrl: string; verifyToken: string; domain: string };
};

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

/** WhatsApp through Meta's Embedded Signup (Cloud API): the one-click way for clients. */
export default function WhatsAppCloudCard({ canManage, onChange }: { canManage: boolean; onChange?: () => void }) {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Status>("/api/whatsapp-cloud").then(setS).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const disconnect = async () => {
    if (!confirm("Disconnect this WhatsApp number? Messages stop arriving until you connect again.")) return;
    setBusy(true);
    try { await api("/api/whatsapp-cloud", { method: "DELETE" }); load(); onChange?.(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const acc = s?.account;
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#25D366] text-white"><MessageCircle size={18} /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="font-semibold">WhatsApp <span className="ml-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">RECOMMENDED</span></h2>
          <p className="text-xs text-ink-3">Connect your WhatsApp Business number in a Meta pop-up. Meta bills message fees to your own card, with no markup.</p>
        </div>
        {acc
          ? <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ok-soft px-2.5 text-xs font-medium text-ok"><CheckCircle2 size={13} />Connected</span>
          : <span className="inline-flex h-6 items-center rounded-full bg-warn-soft px-2.5 text-xs font-medium text-warn">Not connected</span>}
      </header>
      <div className="space-y-4 p-5 text-sm">
        {err && <p className="rounded-xl bg-danger-soft px-3 py-2 text-danger">{err}</p>}
        {!s ? <div className="grid h-14 place-items-center text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
          : acc ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#25D366]/15 text-[#128C7E]"><MessageCircle size={20} /></span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="font-semibold">{acc.verifiedName}</div>
                <div className="text-xs text-ink-3">{acc.displayPhone} · connected {new Date(acc.connectedAt).toLocaleDateString()}{acc.connectedBy ? ` by ${acc.connectedBy}` : ""}</div>
              </div>
              {canManage && <button className="btn" disabled={busy} onClick={disconnect}><Unplug size={15} />Disconnect</button>}
            </div>
          ) : !s.signup ? (
            <p className="flex items-start gap-2 rounded-xl bg-panel-2 px-3.5 py-3 text-ink-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
              {s.setup ? "Not set up on the server yet: add META_APP_ID, META_APP_SECRET and META_ES_CONFIG_ID, then redeploy." : "One-click WhatsApp connection is coming very soon. Meanwhile we can connect your number with you on a short call."}
            </p>
          ) : (
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-5 text-ink-2">
                <li>Click Connect and log in with the Facebook account that manages your business.</li>
                <li>Pick or create your WhatsApp Business account, and add your number (verify it with the SMS code).</li>
                <li>Done: we set up the number and messages start arriving in your Inbox.</li>
              </ol>
              <p className="text-xs text-ink-3">The number can&apos;t be in use on the regular WhatsApp app at the same time. Delete it there first, or use a new number.</p>
              {canManage
                ? <ConnectWhatsApp signup={s.signup} onConnected={() => { load(); onChange?.(); }} onError={setErr} />
                : <p className="text-xs text-ink-3">Ask your workspace owner or an admin to connect WhatsApp.</p>}
            </div>
          )}

        {s?.setup && (
          <details className="rounded-2xl border border-dashed border-line px-4 py-3">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-2"><ShieldCheck size={14} />Platform setup (admins only, done once in the Meta app)</summary>
            <div className="mt-3 space-y-3">
              <CopyRow label="Meta app → WhatsApp → Configuration → Webhook → Callback URL" value={s.setup.callbackUrl} />
              <CopyRow label="Verify token" value={s.setup.verifyToken} />
              <CopyRow label="Facebook Login for Business → Settings → Allowed domains for the JavaScript SDK" value={s.setup.domain} />
              <p className="text-[11px] text-ink-3">Subscribe the webhook field <b>messages</b>. Create an Embedded Signup configuration under Facebook Login for Business → Configurations and put its ID in META_ES_CONFIG_ID.</p>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
