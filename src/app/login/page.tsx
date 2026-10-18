'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Loader2, Lock, User } from 'lucide-react';
import AuthLayout from '@/components/shell/AuthLayout';

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
    <AuthLayout>
      <form onSubmit={submit}>
        <h1 className="font-display text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-ink-2">Welcome back. Your leads have been answered while you were away.</p>

        <div className="mt-7 flex flex-col gap-4">
          <label>
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2"><User size={13} className="text-ink-3" />Username or email</span>
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
        <p className="mt-6 text-center text-sm text-ink-2">New here? <Link href="/signup" className="font-medium text-brand hover:underline">Start with Sixty</Link></p>
      </form>
    </AuthLayout>
  );
}
