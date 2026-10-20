"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";

// Meta's Embedded Signup: a Facebook pop-up where the client logs in, picks or creates their
// WhatsApp Business account and verifies their number. We get a code (and the account ids).

type Signup = { appId: string; configId: string; version: string };
type FBLoginResponse = { authResponse?: { code?: string } | null; status?: string };
type FBType = {
  init: (o: object) => void;
  login: (cb: (r: FBLoginResponse) => void, o: object) => void;
};
declare global { interface Window { FB?: FBType; fbAsyncInit?: () => void } }

let sdkLoading: Promise<void> | null = null;
function loadSdk(s: Signup) {
  if (window.FB) return Promise.resolve();
  sdkLoading ??= new Promise<void>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: s.appId, autoLogAppEvents: true, xfbml: false, version: s.version });
      resolve();
    };
    const el = document.createElement("script");
    el.src = "https://connect.facebook.net/en_US/sdk.js";
    el.async = true;
    el.defer = true;
    el.crossOrigin = "anonymous";
    el.onerror = () => { sdkLoading = null; reject(new Error("Couldn't load Facebook. Check that no ad blocker is blocking connect.facebook.net.")); };
    document.body.appendChild(el);
  });
  return sdkLoading;
}

export default function ConnectWhatsApp({ signup, onConnected, onError, label = "Connect WhatsApp", className = "" }: {
  signup: Signup; onConnected: (phone: { displayPhone: string; verifiedName: string }) => void; onError: (msg: string) => void;
  label?: string; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const session = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  // The pop-up posts the chosen account ids back to this window.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(e.origin).hostname)) return;
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (d.data?.waba_id) session.current = { wabaId: String(d.data.waba_id), phoneNumberId: d.data.phone_number_id ? String(d.data.phone_number_id) : undefined };
      } catch { /* other Facebook messages */ }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => { void loadSdk(signup).catch(() => {}); }, [signup]);

  const finish = useCallback(async (code: string) => {
    try {
      const res = await fetch("/api/whatsapp-cloud/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, ...session.current }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't connect WhatsApp.");
      onConnected(d.phone);
    } catch (e) { onError((e as Error).message); }
    setBusy(false);
  }, [onConnected, onError]);

  const start = async () => {
    setBusy(true);
    session.current = {};
    try { await loadSdk(signup); } catch (e) { onError((e as Error).message); setBusy(false); return; }
    // FB.login wants a plain (non-async) callback.
    window.FB!.login((r) => {
      const code = r.authResponse?.code;
      if (code) void finish(code);
      else { setBusy(false); if (r.status !== "unknown") onError("WhatsApp setup was not completed."); }
    }, {
      config_id: signup.configId,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
    });
  };

  return (
    <button type="button" onClick={start} disabled={busy} className={`btn btn-primary inline-flex ${className}`}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : <MessageCircle size={15} />}{busy ? "Finishing in the pop-up…" : label}
    </button>
  );
}
