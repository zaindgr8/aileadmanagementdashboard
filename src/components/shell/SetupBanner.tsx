'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Rocket } from 'lucide-react';
import type { SetupStep } from '@/lib/tenant/types';

/** On Home, until the workspace is fully set up: how far along it is and a way back to Get started. */
export default function SetupBanner() {
  const [steps, setSteps] = useState<SetupStep[] | null>(null);
  useEffect(() => {
    fetch('/api/onboarding').then((r) => (r.ok ? r.json() : null)).then((d) => d && setSteps(d.steps)).catch(() => {});
  }, []);
  if (!steps || steps.every((s) => s.done || s.optional)) return null;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.optional);
  const label: Record<string, string> = { whatsapp: 'Connect WhatsApp', business: 'Tell us about your business', agent: 'Your agent is being built', instagram: 'Connect Instagram', team: 'Invite your team' };
  return (
    <Link href="/setup" className="card mb-6 flex items-center gap-4 border-brand/30 px-5 py-4 transition hover:border-brand/60">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><Rocket size={19} /></span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block font-semibold">Finish setting up Sixty</span>
        <span className="mt-0.5 block text-sm text-ink-2">{done} of {steps.length} steps done{next ? ` · Next: ${label[next.key] ?? next.key}` : ''}</span>
      </span>
      <span className="hidden h-2 w-32 overflow-hidden rounded-full bg-panel-2 sm:block"><span className="block h-full rounded-full bg-brand" style={{ width: `${(done / steps.length) * 100}%` }} /></span>
      <ArrowRight size={17} className="text-ink-3" />
    </Link>
  );
}
