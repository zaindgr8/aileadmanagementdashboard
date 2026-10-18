'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Lock, Mail, User } from 'lucide-react';
import AuthLayout from '@/components/shell/AuthLayout';

type Info = { workspace: string; email: string; name: string; role: string; modules: string[]; pending: boolean; expiresAt: string };

// Someone opened an invite link: they pick a username and password, then land in the workspace.
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: '', username: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    fetch(`/api/invite/${encodeURIComponent(token)}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'This invite link is not valid.'); return; }
      setInfo(d);
      setF((x) => ({ ...x, name: d.name || '', email: d.email || '', username: (d.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32) }));
    }).catch(() => setError('Network error. Please reload.'));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/invite/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.pending) { setWaiting(true); return; }
      if (r.ok) { window.location.href = '/'; return; }
      setError(d.error || 'Could not accept the invite.');
    } catch {
      setError('Network error. Please try again.');
    }
    setBusy(false);
  };

  if (waiting) {
    return (
      <AuthLayout>
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-ok-soft text-ok"><CheckCircle2 size={24} /></div>
        <h1 className="mt-5 font-display text-2xl font-semibold">Account created</h1>
        <p className="mt-2 text-sm text-ink-2">{info?.workspace} is still waiting for approval. You can sign in as <b className="text-ink">{f.username}</b> as soon as it&apos;s live.</p>
        <Link href="/login" className="btn mt-8 w-full py-2.5">Go to sign in</Link>
      </AuthLayout>
    );
  }

  if (!info) {
    return (
      <AuthLayout>
        {error ? (
          <>
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-warn-soft text-warn"><AlertTriangle size={24} /></div>
            <h1 className="mt-5 font-display text-2xl font-semibold">Invite unavailable</h1>
            <p className="mt-2 text-sm text-ink-2">{error}</p>
            <Link href="/login" className="btn mt-8 w-full py-2.5">Go to sign in</Link>
          </>
        ) : <div className="grid h-40 place-items-center text-ink-3"><Loader2 className="animate-spin" /></div>}
      </AuthLayout>
    );
  }

  const role = info.role === 'owner' ? 'owner' : info.role === 'admin' ? 'an admin' : 'a teammate';
  return (
    <AuthLayout>
      <form onSubmit={submit}>
        <p className="text-xs font-semibold uppercase tracking-[.08em] text-brand">You&apos;re invited</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Join {info.workspace}</h1>
        <p className="mt-1 text-sm text-ink-2">You&apos;ll join as {info.role === 'owner' ? 'the' : ''} {role}. Choose how you&apos;ll sign in.</p>

        <div className="mt-6 flex flex-col gap-3.5">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><User size={13} className="text-ink-3" />Your name</span>
            <input className="input" required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><Mail size={13} className="text-ink-3" />Email</span>
            <input className="input" type="email" value={f.email} disabled={Boolean(info.email)} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><User size={13} className="text-ink-3" />Username</span>
            <input className="input" required minLength={3} value={f.username} autoCapitalize="none" autoComplete="username"
              onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><Lock size={13} className="text-ink-3" />Password (min 8 characters)</span>
            <input className="input" type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          </label>
        </div>

        {error && <div role="alert" className="mt-4 rounded-lg border border-bad/20 bg-bad-soft px-3 py-2 text-xs font-medium text-bad">{error}</div>}

        <button type="submit" className="btn btn-primary mt-6 w-full py-2.5" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <>Create account <ArrowRight size={15} /></>}
        </button>
        <p className="mt-3 text-center text-[11px] text-ink-3">This link works once and expires {new Date(info.expiresAt).toLocaleDateString()}.</p>
      </form>
    </AuthLayout>
  );
}
