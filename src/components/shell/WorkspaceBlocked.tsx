'use client';
import { Clock, LogOut, PauseCircle } from 'lucide-react';

/** Shown instead of the app when the workspace is waiting for approval or has been suspended. */
export default function WorkspaceBlocked({ name, status }: { name: string; status: string }) {
  const pending = status === 'pending';
  const logout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    window.location.href = '/login';
  };
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card anim-rise w-full max-w-md p-8 text-center">
        <span className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl ${pending ? 'bg-warn-soft text-warn' : 'bg-panel-2 text-ink-3'}`}>
          {pending ? <Clock size={24} /> : <PauseCircle size={24} />}
        </span>
        <h1 className="mt-5 font-display text-xl font-semibold">{pending ? `${name} is waiting for approval` : `${name} is ${status === 'missing' ? 'not available' : 'suspended'}`}</h1>
        <p className="mt-2 text-sm text-ink-2">
          {pending ? "We review every new workspace. You'll be able to use it as soon as it's approved." : 'Contact the Sixty team at management@devmatesolutions.com to restore access.'}
        </p>
        <button onClick={logout} className="btn mx-auto mt-6"><LogOut size={15} />Sign out</button>
      </div>
    </div>
  );
}
