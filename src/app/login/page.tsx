'use client';
import Image from 'next/image';
import { useState } from 'react';
import { ArrowRight, Loader2, Lock, MessageCircle, PhoneCall, Sparkles, User } from 'lucide-react';
import { ThemeToggle } from '@/components/shell/theme';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const next = new URLSearchParams(window.location.search).get('next');
        window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Incorrect username or password');
    } catch {
      setError('Network error. Please try again.');
    }
    setBusy(false);
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-side p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full opacity-40 blur-3xl" style={{ background: 'radial-gradient(circle, var(--brand) 0%, transparent 70%)' }} />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(45deg, #fff 25%, transparent 25%, transparent 75%, #fff 75%), linear-gradient(45deg, #fff 25%, transparent 25%, transparent 75%, #fff 75%)', backgroundSize: '64px 64px', backgroundPosition: '0 0, 32px 32px', maskImage: 'linear-gradient(to top, black, transparent 70%)' }} />
        <div className="relative flex items-center gap-3">
          <Image src="/logo-mark.png" alt="" width={40} height={40} className="rounded-lg" priority />
          <div className="leading-tight">
            <div className="font-display text-lg font-semibold">AI Lead Management</div>
            <div className="text-xs text-white/60">by DevMate Solutions</div>
          </div>
        </div>
        <div className="relative mt-auto max-w-md">
          <h2 className="font-display text-4xl font-semibold leading-[1.1]">Checkmate your sales goals.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70">One place for every lead: AI agents answer WhatsApp and make calls for you, score each conversation, and tell your team who to follow up next.</p>
          <ul className="mt-8 space-y-3 text-sm text-white/85">
            <li className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10"><MessageCircle size={16} /></span>WhatsApp AI agent, live inbox and pipeline</li>
            <li className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10"><PhoneCall size={16} /></span>AI voice calls, bulk campaigns and recordings</li>
            <li className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10"><Sparkles size={16} /></span>Lead scoring and AI briefs on every channel</li>
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-white/40">devmatesolutions.com</p>
      </aside>

      {/* Sign-in form */}
      <main className="relative grid place-items-center px-4 py-10">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <form onSubmit={submit} className="anim-rise w-full max-w-sm">
          <Image src="/logo.png" alt="DevMate" width={142} height={50} className="-ml-2 mb-8 h-[50px] w-auto" priority />
          <h1 className="font-display text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-ink-2">Welcome back to AI Lead Management.</p>

          <div className="mt-7 flex flex-col gap-4">
            <label>
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><User size={13} className="text-ink-3" />Username</span>
              <input className="input" type="text" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username"
                value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>
            <label>
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><Lock size={13} className="text-ink-3" />Password</span>
              <input className="input" type="password" autoComplete="current-password" placeholder="••••••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          </div>

          {error && <div role="alert" className="mt-4 rounded-lg border border-bad/20 bg-bad-soft px-3 py-2 text-xs font-medium text-bad">{error}</div>}

          <button type="submit" className="btn btn-primary mt-6 w-full py-2.5" disabled={busy || !username || !password}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <>Sign in <ArrowRight size={15} /></>}
          </button>
          <p className="mt-8 text-center text-[11px] text-ink-3">Checkmate your goals · DevMate Solutions</p>
        </form>
      </main>
    </div>
  );
}
