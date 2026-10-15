'use client';
import { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { api, useLive } from '@/lib/whatsapp/client';

type Env = { twilioConfigured: boolean; aiConfigured: boolean; demo: boolean };

/** WhatsApp module frame: setup warnings above the page. */
export default function WhatsAppFrame({ children }: { children: React.ReactNode }) {
  const [env, setEnv] = useState<Env | null>(null);
  const [mode, setMode] = useState<'n8n' | 'claude'>('claude');

  const load = useCallback(() => {
    api<{ settings: { agentMode: 'n8n' | 'claude' }; env: Env }>('/api/whatsapp/settings')
      .then((r) => { setMode(r.settings.agentMode); setEnv(r.env); })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  useLive((e) => e.type === 'settings' && load());

  const needsAi = mode === 'claude' && env && !env.aiConfigured;
  return (
    <div className="flex h-full flex-col">
      {env && (env.demo || needsAi) && (
        <div className="flex items-center gap-2 border-b border-line bg-warn-soft px-4 py-1.5 text-xs text-warn">
          <Zap size={13} className="shrink-0" />
          <span>
            {env.demo ? 'Demo mode: sample chats shown. Add your Twilio credentials to .env.local to go live.' : ''}
            {env.demo && needsAi ? ' · ' : ''}
            {needsAi ? 'Set ANTHROPIC_API_KEY to turn on AI replies and AI lead scoring.' : ''}
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
