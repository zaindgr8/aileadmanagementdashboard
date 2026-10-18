'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Building2, CheckCircle2, Clock, Loader2, Lock, Mail, MessageCircle, PhoneCall, User } from 'lucide-react';
import AuthLayout from '@/components/shell/AuthLayout';

// Self sign-up: creates a workspace that waits for approval, with the person as its owner.
export default function Signup() {
  const [f, setF] = useState({ company: '', name: '', email: '', username: '', password: '', calls: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: k === 'calls' ? e.target.checked : k === 'username' ? e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') : e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, modules: f.calls ? ['whatsapp', 'calls'] : ['whatsapp'] }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setDone(data.workspace?.name ?? f.company); return; }
      setError(data.error || 'Could not create your workspace.');
    } catch {
      setError('Network error. Please try again.');
    }
    setBusy(false);
  };

  if (done) {
    return (
      <AuthLayout>
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-ok-soft text-ok"><CheckCircle2 size={24} /></div>
        <h1 className="mt-5 font-display text-2xl font-semibold">You&apos;re on the list</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          We&apos;ve created <b className="text-ink">{done}</b>. Our team reviews every new workspace. Once it&apos;s approved you can sign in with
          <b className="text-ink"> {f.username}</b> and connect WhatsApp.
        </p>
        <ol className="mt-6 space-y-3 text-sm">
          {[
            ['Workspace created', true],
            ['Approval by our team (usually within a day)', false],
            ['Connect WhatsApp and your AI agent', false],
          ].map(([t, ok], i) => (
            <li key={i} className="flex items-center gap-3">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${ok ? 'bg-ok text-white' : 'bg-panel-2 text-ink-3'}`}>{ok ? '✓' : i + 1}</span>
              <span className={ok ? 'text-ink' : 'text-ink-2'}>{t}</span>
            </li>
          ))}
        </ol>
        <Link href="/login" className="btn mt-8 w-full py-2.5">Back to sign in</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form onSubmit={submit}>
        <h1 className="font-display text-2xl font-semibold">Create your workspace</h1>
        <p className="mt-1 text-sm text-ink-2">Your own inbox, AI agent and lead pipeline. We approve new workspaces before they go live.</p>

        <div className="mt-6 flex flex-col gap-3.5">
          <Field icon={Building2} label="Company or brand">
            <input className="input" required autoFocus value={f.company} onChange={set('company')} placeholder="Acme Realty" autoComplete="organization" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field icon={User} label="Your name">
              <input className="input" required value={f.name} onChange={set('name')} autoComplete="name" />
            </Field>
            <Field icon={User} label="Username">
              <input className="input" required minLength={3} value={f.username} onChange={set('username')} autoCapitalize="none" autoComplete="username" />
            </Field>
          </div>
          <Field icon={Mail} label="Work email">
            <input className="input" type="email" required value={f.email} onChange={set('email')} autoComplete="email" />
          </Field>
          <Field icon={Lock} label="Password (min 8 characters)">
            <input className="input" type="password" required minLength={8} value={f.password} onChange={set('password')} autoComplete="new-password" />
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-ink-2">What do you need?</legend>
            <div className="grid grid-cols-2 gap-2">
              <span className="flex items-center gap-2 rounded-xl border border-brand bg-brand/5 px-3 py-2.5 text-sm font-medium"><MessageCircle size={16} className="text-brand" />WhatsApp</span>
              <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium ${f.calls ? 'border-brand bg-brand/5' : 'border-line'}`}>
                <input type="checkbox" className="sr-only" checked={f.calls} onChange={set('calls')} />
                <PhoneCall size={16} className={f.calls ? 'text-brand' : 'text-ink-3'} />AI voice calls
              </label>
            </div>
          </fieldset>
        </div>

        {error && <div role="alert" className="mt-4 rounded-lg border border-bad/20 bg-bad-soft px-3 py-2 text-xs font-medium text-bad">{error}</div>}

        <button type="submit" className="btn btn-primary mt-6 w-full py-2.5" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <>Create workspace <ArrowRight size={15} /></>}
        </button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-ink-3"><Clock size={12} />You&apos;ll be able to sign in once we approve it.</p>
        <p className="mt-5 text-center text-sm text-ink-2">Already have an account? <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}

function Field({ icon: Icon, label, children }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><Icon size={13} className="text-ink-3" />{label}</span>
      {children}
    </label>
  );
}
