"use client";
import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, MessageSquarePlus, Send, X } from "lucide-react";
import { api, useAgentName } from "@/lib/whatsapp/client";
import type { Conversation } from "@/lib/whatsapp/types";

type Template = { sid: string; name: string; language: string; status: string; variables: Record<string, string>; body?: string };
type Conv = Conversation & { sessionOpen?: boolean };

/** "+971 50 123 4567" / "00971501234567" → "+971501234567", or "" if it doesn't look like a full international number. */
function toE164(raw: string) {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = `+${d.slice(2)}`;
  if (!d.startsWith("+")) d = `+${d}`;
  return /^\+[1-9]\d{6,14}$/.test(d) ? d : "";
}

/**
 * Start a WhatsApp conversation with anyone. WhatsApp only allows free text within 24 hours of the
 * customer's last message, so new contacts (or old ones gone quiet) get an approved template.
 */
export default function NewMessage({ convs, onClose, onSent }: {
  convs: Conv[]; onClose: () => void; onSent: (conversationId: string) => void;
}) {
  const agentName = useAgentName();
  const [phone, setPhone] = useState("");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tplError, setTplError] = useState("");
  const [picked, setPicked] = useState<Template | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [letAgent, setLetAgent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    api<{ env: { demo: boolean } }>("/api/whatsapp/settings").then((r) => setDemo(r.env.demo)).catch(() => {});
    api<Template[] | { error: string }>("/api/whatsapp/templates")
      .then((r) => (Array.isArray(r) ? setTemplates(r) : setTplError(r.error)))
      .catch((e) => { setTemplates([]); setTplError((e as Error).message); });
  }, []);

  const e164 = toE164(phone);
  const id = e164 ? `whatsapp:${e164}` : "";
  const existing = useMemo(() => convs.find((c) => c.id === id), [convs, id]);
  // Free text is allowed while the 24-hour window is open (or in demo mode, where nothing is really sent).
  const canText = demo || Boolean(existing?.sessionOpen);
  const approved = (templates ?? []).filter((t) => t.status === "approved" || t.status === "unknown");
  const varKeys = picked ? Object.keys(picked.variables ?? {}).sort((a, b) => Number(a) - Number(b)) : [];
  const preview = picked?.body ? picked.body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] || `{{${k}}}`) : "";

  const choose = (t: Template) => {
    setPicked(t);
    setVars(Object.fromEntries(Object.keys(t.variables ?? {}).map((k) => [k, ""])));
  };

  const send = async () => {
    if (!id) { setErr("Enter the full number with country code, e.g. +971501234567."); return; }
    setBusy(true); setErr("");
    try {
      const body = canText && !picked
        ? { body: text.trim(), pauseAi: !letAgent }
        : { contentSid: picked!.sid, contentVariables: vars, body: preview || undefined, pauseAi: !letAgent };
      await api(`/api/whatsapp/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", json: body });
      onSent(id);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const ready = Boolean(id) && (picked ? varKeys.every((k) => vars[k]?.trim()) : canText && text.trim().length > 0);

  return (
    <div data-modal className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="card anim-pop flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <MessageSquarePlus size={18} className="text-brand" />
          <h3 className="font-semibold">New WhatsApp message</h3>
          <button onClick={onClose} className="ml-auto text-ink-3"><X size={18} /></button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-2">To (WhatsApp number with country code)</span>
            <input className="input font-mono" autoFocus inputMode="tel" placeholder="+971 50 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {phone && !e164 && <span className="mt-1 block text-[11px] text-warn">Include the country code, e.g. +971 for UAE, +92 for Pakistan.</span>}
            {existing && <span className="mt-1 block text-[11px] text-ink-3">Already in your inbox{existing.name || existing.profileName ? ` as ${existing.name || existing.profileName}` : ""}.{existing.sessionOpen ? " They messaged in the last 24 hours, so you can write freely." : ""}</span>}
          </label>

          {canText && !picked && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-2">Message</span>
              <textarea className="input min-h-28" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your message…" />
            </label>
          )}

          {!canText && (
            <p className="rounded-xl bg-info-soft px-3.5 py-2.5 text-xs leading-relaxed text-info">
              WhatsApp only lets businesses message someone first with an <b>approved template</b>. Once they reply, you (or {agentName}) can chat freely for 24 hours.
            </p>
          )}

          <div>
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><FileText size={13} />{canText ? "Or send a template" : "Template"}</span>
            {!templates ? (
              <div className="grid h-16 place-items-center text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
            ) : approved.length ? (
              <ul className="space-y-1.5">
                {approved.map((t) => (
                  <li key={t.sid}>
                    <button type="button" onClick={() => (picked?.sid === t.sid ? setPicked(null) : choose(t))}
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-left text-sm transition ${picked?.sid === t.sid ? "border-brand bg-brand/5" : "border-line hover:bg-panel-2"}`}>
                      <span className="flex items-center gap-2"><span className="font-medium">{t.name}</span><span className="text-[11px] text-ink-3">{t.language}</span></span>
                      {t.body && <span className="mt-0.5 line-clamp-2 block text-xs text-ink-2">{t.body}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-xs text-ink-3">
                {tplError || "No approved templates yet."} Create one in Twilio Console → Messaging → Content Template Builder and submit it for WhatsApp approval (usually minutes to a day).
              </p>
            )}
          </div>

          {picked && varKeys.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {varKeys.map((k) => (
                <label key={k} className="block">
                  <span className="mb-1 block text-[11px] font-medium text-ink-2">{`{{${k}}}`}{picked.variables[k] ? <span className="text-ink-3"> · e.g. {picked.variables[k]}</span> : null}</span>
                  <input className="input" value={vars[k] ?? ""} onChange={(e) => setVars({ ...vars, [k]: e.target.value })} />
                </label>
              ))}
            </div>
          )}
          {preview && (
            <div className="rounded-2xl rounded-tr-md bg-bubble-out px-3.5 py-2.5 text-sm shadow-[0_1px_0.5px_rgba(0,0,0,0.08)]">
              <span className="mb-1 block text-[11px] font-semibold text-ink-3">Preview</span>
              <p className="whitespace-pre-wrap">{preview}</p>
            </div>
          )}

          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5" checked={letAgent} onChange={(e) => setLetAgent(e.target.checked)} />
            <span>Let {agentName} handle their reply<span className="block text-xs text-ink-3">Untick to keep the chat with you (manual mode).</span></span>
          </label>
          {err && <p className="text-sm text-danger">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={send}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Send
          </button>
        </div>
      </div>
    </div>
  );
}
