"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight, Bot, Building2, Check, CheckCircle2, ChevronDown, FileText, Loader2, MessageCircle, PartyPopper, Trash2, Upload, UserCheck, Users, X,
} from "lucide-react";
import { api } from "@/lib/whatsapp/client";
import type { BusinessInfo, SetupStep, SetupStepKey } from "@/lib/tenant/types";
import ConnectWhatsApp from "@/components/settings/ConnectWhatsApp";

type View = {
  workspace: { id: string; name: string; modules: string[] };
  steps: SetupStep[];
  business: BusinessInfo;
  docs: { id: string; name: string; chars: number; addedAt: string }[];
  submittedAt: string | null;
  agentLiveAt: string | null;
  instagram: { appReady: boolean; username: string | null };
  canEdit: boolean;
};

// Where "Book setup call" / "Message the Sixty team" go: a WhatsApp number if configured, otherwise email.
const SUPPORT_WA = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || "").replace(/\D/g, "");
const HELP_WHATSAPP = SUPPORT_WA
  ? `https://wa.me/${SUPPORT_WA}?text=${encodeURIComponent("Hi, I'd like help setting up Sixty")}`
  : `mailto:management@devmatesolutions.com?subject=${encodeURIComponent("Help setting up Sixty")}`;

function InstagramGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

const META: Record<SetupStepKey, { title: string; desc: string; icon: React.ComponentType<{ size?: number }> }> = {
  account: { title: "Create your account", desc: "You're in. Welcome to Sixty.", icon: UserCheck },
  whatsapp: { title: "Connect WhatsApp", desc: "The number your customers message. Takes about 5 minutes.", icon: MessageCircle },
  instagram: { title: "Connect Instagram", desc: "Answer DMs, story replies and comments in the same inbox.", icon: InstagramGlyph },
  business: { title: "Tell us about your business", desc: "Your website, what you sell and common questions. We build your agent from this.", icon: Building2 },
  team: { title: "Invite your team", desc: "Add the people who'll handle hot leads and handoffs.", icon: Users },
  agent: { title: "Your AI agent goes live", desc: "We build and test your agent, then switch it on, usually within 48 hours.", icon: Bot },
};

export default function SetupPage() {
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<SetupStepKey | null>(null);
  const load = useCallback(() => api<View>("/api/onboarding").then((r) => {
    setV(r);
    // Open the first step that still needs doing.
    setOpen((o) => o ?? r.steps.find((s) => !s.done && s.key !== "agent")?.key ?? null);
  }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (!v) return <div className="grid h-full place-items-center text-ink-3">{error ? <p className="text-sm text-danger">{error}</p> : <Loader2 className="animate-spin" />}</div>;

  const required = v.steps.filter((s) => !s.optional);
  const done = v.steps.filter((s) => s.done).length;
  const pct = Math.round((done / v.steps.length) * 100);
  const allRequired = required.every((s) => s.done || s.key === "agent");

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        <div className="mb-7 flex items-center gap-5">
          <div className="relative grid h-[72px] w-[72px] shrink-0 place-items-center">
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--line)" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} />
            </svg>
            <span className="text-sm font-semibold tabular-nums">{pct}%</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Get started with Sixty</h1>
            <p className="text-sm text-ink-2">{v.agentLiveAt ? "You're all set: your agent is live and answering leads." : allRequired ? "Thanks! We're building your agent and will switch it on shortly." : `A few quick steps to set up ${v.workspace.name}. You can come back any time.`}</p>
          </div>
        </div>

        {error && <div className="mb-4 flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"><span className="flex-1">{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}

        <ol className="space-y-3">
          {v.steps.map((s, i) => {
            const m = META[s.key];
            const isOpen = open === s.key;
            const clickable = s.key !== "account";
            return (
              <li key={s.key} className={`card overflow-hidden transition ${isOpen ? "ring-1 ring-brand/30" : ""}`}>
                <button disabled={!clickable} onClick={() => setOpen(isOpen ? null : s.key)} className="flex w-full items-center gap-4 px-5 py-4 text-left">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${s.done ? "bg-ok text-white" : "bg-panel-2 text-ink-2"}`}>
                    {s.done ? <Check size={18} /> : <m.icon size={17} />}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="flex items-center gap-2 font-semibold">
                      <span className="text-ink-3">{i + 1}.</span> {m.title}
                      {s.optional && !s.done && <span className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-3">Optional</span>}
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-2">{m.desc}</span>
                  </span>
                  {clickable && <ChevronDown size={18} className={`shrink-0 text-ink-3 transition ${isOpen ? "rotate-180" : ""}`} />}
                </button>
                {isOpen && (
                  <div className="border-t border-line bg-panel-2/40 px-5 py-4">
                    {s.key === "whatsapp" && <WhatsAppStep done={s.done} canEdit={v.canEdit} onConnected={load} onError={setError} />}
                    {s.key === "instagram" && <InstagramStep done={s.done} v={v} />}
                    {s.key === "business" && <BusinessStep v={v} onSaved={(r) => { setV(r); if (r.submittedAt) setOpen(r.steps.find((x) => !x.done && x.key !== "agent")?.key ?? null); }} onError={setError} />}
                    {s.key === "team" && <TeamStep canEdit={v.canEdit} />}
                    {s.key === "agent" && <AgentStep v={v} />}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <p className="mt-6 text-center text-sm text-ink-3">
          Stuck anywhere? <a href={HELP_WHATSAPP} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">Message the Sixty team</a>. We&apos;ll set it up with you on a quick call.
        </p>
      </div>
    </div>
  );
}

function WhatsAppStep({ done, canEdit, onConnected, onError }: { done: boolean; canEdit: boolean; onConnected: () => void; onError: (m: string) => void }) {
  const [signup, setSignup] = useState<{ appId: string; configId: string; version: string } | null | undefined>(undefined);
  useEffect(() => {
    if (done) return;
    api<{ signup: { appId: string; configId: string; version: string } | null }>("/api/whatsapp-cloud").then((r) => setSignup(r.signup)).catch(() => setSignup(null));
  }, [done]);
  if (done) return <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 size={16} />WhatsApp is connected. New messages arrive in your Inbox.</p>;
  return (
    <div className="space-y-3 text-sm">
      {signup && canEdit && (
        <div className="rounded-xl border border-brand/30 bg-panel p-4">
          <p className="font-semibold">Connect in a few clicks <span className="ml-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">FASTEST</span></p>
          <p className="mb-3 mt-1 text-ink-2">Log in with Facebook, pick or create your WhatsApp Business account and verify your number by SMS. Meta bills message fees to your own card.</p>
          <ConnectWhatsApp signup={signup} onConnected={onConnected} onError={onError} />
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-brand/30 bg-panel p-4">
          <p className="font-semibold">Set it up with us <span className="ml-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">EASIEST</span></p>
          <p className="mt-1 text-ink-2">Book a 10-minute call. We register your WhatsApp Business number for you; you just log in to Facebook and read out the SMS code.</p>
          <a href={HELP_WHATSAPP} target="_blank" rel="noreferrer" className="btn btn-primary mt-3 inline-flex">Book setup call <ArrowRight size={15} /></a>
        </div>
        <div className="rounded-xl border border-line bg-panel p-4">
          <p className="font-semibold">Already use Twilio?</p>
          <p className="mt-1 text-ink-2">Paste your Account SID, auth token and WhatsApp number, then click Test connection.</p>
          {canEdit
            ? <Link href="/settings" className="btn mt-3 inline-flex">Open Connections <ArrowRight size={15} /></Link>
            : <p className="mt-3 text-xs text-ink-3">Ask your workspace owner to do this step.</p>}
        </div>
      </div>
      <p className="text-xs text-ink-3">Your number must not be in use on the regular WhatsApp app. We&apos;ll help you move it if it is.</p>
    </div>
  );
}

function InstagramStep({ done, v }: { done: boolean; v: View }) {
  if (done) return <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 size={16} />Connected as @{v.instagram.username}.</p>;
  if (!v.instagram.appReady) return <p className="text-sm text-ink-2">Instagram connection is coming very soon. We&apos;ll let you know when it&apos;s ready. You can skip this for now.</p>;
  return (
    <div className="space-y-3 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-ink-2">
        <li>Your Instagram must be a <b className="text-ink">Professional</b> account.</li>
        <li>In Instagram: Settings → Messages and story replies → Message controls → turn on <b className="text-ink">Allow access to messages</b>.</li>
        <li>Click Connect, log in and press <b className="text-ink">Allow</b>.</li>
      </ol>
      {v.canEdit ? <a href="/api/instagram/connect" className="btn btn-primary inline-flex"><InstagramGlyph size={16} />Connect Instagram</a> : <p className="text-xs text-ink-3">Ask your workspace owner to do this step.</p>}
    </div>
  );
}

const FIELDS: { key: keyof BusinessInfo; label: string; placeholder: string; long?: boolean }[] = [
  { key: "website", label: "Website", placeholder: "https://yourbusiness.com" },
  { key: "about", label: "What does your business do?", placeholder: "We're a real-estate brokerage in Dubai Marina helping families rent and buy apartments…", long: true },
  { key: "offer", label: "What do you sell?", placeholder: "Apartment rentals and sales, property management, mortgage referrals…", long: true },
  { key: "prices", label: "Prices and packages (optional)", placeholder: "1BR from AED 85k/yr, 2BR from AED 120k/yr. Viewings are free…", long: true },
  { key: "customers", label: "Who are your ideal customers?", placeholder: "Families relocating to Dubai, budget AED 100–200k a year…" },
  { key: "goal", label: "What should the agent get leads to do?", placeholder: "Book a viewing / Book a call / Visit the store / Pay a deposit" },
  { key: "bookingLink", label: "Booking or payment link (optional)", placeholder: "https://calendly.com/…" },
  { key: "faqs", label: "Questions customers often ask, with your answers", placeholder: "Do you allow pets? Most buildings do, we'll confirm per unit.\nIs there a commission? 5% for rentals…", long: true },
  { key: "tone", label: "Tone of voice", placeholder: "Friendly and professional, never pushy" },
  { key: "languages", label: "Languages", placeholder: "English, Arabic" },
  { key: "agentName", label: "Name for your AI agent (optional)", placeholder: "Freya" },
];

function BusinessStep({ v, onSaved, onError }: { v: View; onSaved: (r: View) => void; onError: (m: string) => void }) {
  const [f, setF] = useState<BusinessInfo>(v.business);
  const [busy, setBusy] = useState<"" | "save" | "submit" | "upload">("");
  const [docs, setDocs] = useState(v.docs);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ro = !v.canEdit;

  const save = async (submit: boolean) => {
    setBusy(submit ? "submit" : "save");
    try {
      const r = await api<View>("/api/onboarding", { method: "PUT", json: { business: f, submit } });
      onSaved(r); setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { onError((e as Error).message); }
    setBusy("");
  };
  const upload = async (file: File) => {
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/onboarding/docs", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Upload failed");
      setDocs((x) => [...x, d]);
    } catch (e) { onError((e as Error).message); }
    setBusy("");
    if (fileRef.current) fileRef.current.value = "";
  };
  const remove = async (id: string) => {
    try { await api(`/api/onboarding/docs?id=${encodeURIComponent(id)}`, { method: "DELETE" }); setDocs((x) => x.filter((d) => d.id !== id)); }
    catch (e) { onError((e as Error).message); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {FIELDS.map((fl) => (
          <label key={fl.key} className={`block ${fl.long ? "md:col-span-2" : ""}`}>
            <span className="mb-1 block text-xs font-medium text-ink-2">{fl.label}</span>
            {fl.long
              ? <textarea className="input min-h-20 bg-panel" disabled={ro} value={f[fl.key] ?? ""} placeholder={fl.placeholder} onChange={(e) => setF({ ...f, [fl.key]: e.target.value })} />
              : <input className="input bg-panel" disabled={ro} value={f[fl.key] ?? ""} placeholder={fl.placeholder} onChange={(e) => setF({ ...f, [fl.key]: e.target.value })} />}
          </label>
        ))}
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-ink-2">Documents (optional): price list, menu, brochure, FAQ. PDF, text or images, up to 8 MB.</span>
        <ul className="mb-2 space-y-1.5">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2 text-sm">
              <FileText size={15} className="text-ink-3" /><span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-xs text-ink-3">{Math.round(d.chars / 100) / 10}k characters read</span>
              {!ro && <button onClick={() => remove(d.id)} className="rounded p-1 text-ink-3 hover:text-danger" title="Remove"><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
        {!ro && (
          <>
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <button className="btn" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}>
              {busy === "upload" ? <><Loader2 size={15} className="animate-spin" />Reading…</> : <><Upload size={15} />Upload a document</>}
            </button>
          </>
        )}
      </div>

      {!ro && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          {saved && <span className="mr-auto flex items-center gap-1 text-xs text-ok"><Check size={13} />Saved</span>}
          <button className="btn" disabled={Boolean(busy)} onClick={() => save(false)}>{busy === "save" && <Loader2 size={15} className="animate-spin" />}Save for later</button>
          <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => save(true)}>
            {busy === "submit" && <Loader2 size={15} className="animate-spin" />}{v.submittedAt ? "Update details" : "Send to the Sixty team"}<ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function TeamStep({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <p className="flex-1 text-ink-2">Create an invite link for each teammate. They choose their own login, and you decide whether they handle WhatsApp, calls or both.</p>
      {canEdit ? <Link href="/settings" className="btn">Invite people <ArrowRight size={15} /></Link> : <p className="text-xs text-ink-3">Ask your workspace owner to invite people.</p>}
    </div>
  );
}

function AgentStep({ v }: { v: View }) {
  if (v.agentLiveAt) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <PartyPopper size={18} className="text-brand" />
        <p className="flex-1">Your agent is live since {new Date(v.agentLiveAt).toLocaleDateString()}. Watch it work in the Inbox, and give it special instructions for any lead with <b>Brief</b>.</p>
        <Link href="/whatsapp" className="btn btn-primary">Open inbox <ArrowRight size={15} /></Link>
      </div>
    );
  }
  return (
    <p className="text-sm text-ink-2">
      {v.submittedAt
        ? "We have your details. Our team is training and testing your agent on your business, and will switch it on within 48 hours. We'll message you when it's live."
        : "Once you've connected WhatsApp and told us about your business, we build your agent, test it with you, and switch it on."}
    </p>
  );
}
