'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Search, ShieldCheck } from 'lucide-react';
import type { SessionUser } from '@/lib/auth/modules';
import type { WorkspaceSummary } from '@/lib/tenant/types';

/** The workspace you're in. Platform admins can jump to any other workspace from here. */
export default function WorkspaceSwitcher({ user, rail }: { user: SessionUser; rail: boolean }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<WorkspaceSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!list) fetch('/api/admin/workspaces').then((r) => r.json()).then((d) => Array.isArray(d) && setList(d)).catch(() => {});
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, list]);

  const go = async (id: string) => {
    if (id === user.workspace) { setOpen(false); return; }
    setBusy(id);
    const r = await fetch('/api/admin/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: id }) });
    if (r.ok) window.location.assign('/');
    else setBusy('');
  };

  const workspaceDisplayName = user.workspaceName || user.workspace || 'Workspace';
  const initial = workspaceDisplayName.slice(0, 1).toUpperCase();
  const badge = <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/10 text-xs font-semibold text-white">{initial}</span>;

  if (!user.platformAdmin) {
    return rail
      ? <div className="mb-4 flex justify-center" title={workspaceDisplayName}>{badge}</div>
      : <div className="mx-3 mb-4 flex items-center gap-2.5 rounded-xl bg-white/[.04] px-2.5 py-2">{badge}<span className="min-w-0 truncate text-[13px] font-medium text-white">{workspaceDisplayName}</span></div>;
  }

  const shown = (list ?? []).filter((w) => !q || `${w.name} ${w.id}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={ref} className={`relative mb-4 ${rail ? 'flex justify-center' : 'mx-3'}`}>
      <button onClick={() => setOpen((o) => !o)} title={`Workspace: ${workspaceDisplayName}`}
        className={`flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[.04] px-2.5 py-2 text-left transition hover:border-white/20 ${rail ? 'w-auto justify-center px-1.5' : ''}`}>
        {badge}
        {!rail && <>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-medium text-white">{workspaceDisplayName}</span>
            <span className="block text-[10.5px] text-side-ink">Switch workspace</span>
          </span>
          <ChevronsUpDown size={14} className="text-side-ink" />
        </>}
      </button>

      {open && (
        <div className="card anim-pop absolute left-0 top-full z-50 mt-2 w-[260px] overflow-hidden text-ink">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search size={14} className="text-ink-3" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a workspace…" className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3" />
          </div>
          <ul className="scroll-thin max-h-72 overflow-y-auto p-1.5">
            {!list && <li className="grid h-16 place-items-center text-ink-3"><Loader2 size={16} className="animate-spin" /></li>}
            {shown.map((w) => (
              <li key={w.id}>
                <button onClick={() => go(w.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-panel-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/10 text-xs font-semibold text-brand">{w.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-medium">{w.name}</span>
                    <span className={`block text-[11px] ${w.status === 'active' ? 'text-ink-3' : 'text-warn'}`}>{w.status === 'active' ? `${w.conversations} chats` : w.status}</span>
                  </span>
                  {busy === w.id ? <Loader2 size={14} className="animate-spin text-ink-3" /> : w.id === user.workspace && <Check size={15} className="text-brand" />}
                </button>
              </li>
            ))}
            {list && !shown.length && <li className="px-3 py-4 text-center text-xs text-ink-3">No match.</li>}
          </ul>
          <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-xs font-medium text-ink-2 hover:bg-panel-2"><ShieldCheck size={14} />Admin console</Link>
        </div>
      )}
    </div>
  );
}
