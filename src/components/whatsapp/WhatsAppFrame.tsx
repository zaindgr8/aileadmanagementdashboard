'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { api, useLive } from '@/lib/whatsapp/client';

type Env = { twilioConfigured: boolean; aiConfigured: boolean; demo: boolean };

/** WhatsApp module frame: setup warnings above the page. */
export default function WhatsAppFrame({ children }: { children: React.ReactNode }) {
  const [env, setEnv] = useState<Env | null>(null);
  const [mode, setMode] = useState<'n8n' | 'builtin'>('builtin');

  const load = useCallback(() => {
    api<{ settings: { agentMode: 'n8n' | 'builtin' }; env: Env }>('/api/whatsapp/settings')
      .then((r) => { setMode(r.settings.agentMode); setEnv(r.env); })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  useLive((e) => e.type === 'settings' && load());

  const needsAi = mode === 'builtin' && env && !env.aiConfigured;
  return (
    <div className="flex h-full flex-col">
      {env && (env.demo || needsAi) && (
        <div className="flex items-center gap-2 border-b border-line bg-warn-soft px-4 py-1.5 text-xs text-warn">
          <Zap size={13} className="shrink-0" />
          <span>
            {env.demo ? <>WhatsApp isn&apos;t connected yet. <Link href="/settings" className="font-semibold underline">Connect your Twilio number</Link> to start receiving chats.</> : ''}
            {env.demo && needsAi ? ' · ' : ''}
            {needsAi ? 'Set GEMINI_API_KEY to turn on AI replies and AI lead scoring.' : ''}
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
