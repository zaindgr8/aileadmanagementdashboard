import 'server-only';
import type { Batch } from '@/lib/voice/types';
import { sb } from '@/lib/supabase';
import { workspaceId, wsFilter } from '@/lib/tenant/context';

// Retell has no "list batch calls" endpoint, so campaigns launched from the
// dashboard are logged in Supabase (`call_campaigns`).
interface CampaignRow {
  batch_call_id: string;
  name: string;
  from_number: string;
  agent_id: string | null;
  agent_name: string | null;
  total: number;
  skipped: number;
  scheduled_at: string;
  created_at: string;
  call_window: Batch['window'];
}

export async function readBatches(): Promise<Batch[]> {
  const rows = await sb<CampaignRow[]>(`call_campaigns?${await wsFilter()}&select=*&order=created_at.desc&limit=500`);
  return rows.map((r) => ({
    batch_call_id: r.batch_call_id,
    name: r.name,
    from_number: r.from_number,
    agent_id: r.agent_id,
    agent_name: r.agent_name,
    total: r.total,
    skipped: r.skipped,
    scheduled_at: new Date(r.scheduled_at).getTime(),
    created_at: new Date(r.created_at).getTime(),
    window: r.call_window,
  }));
}

export async function saveBatch(b: Batch) {
  await sb('call_campaigns', {
    method: 'POST',
    body: {
      workspace_id: await workspaceId(),
      batch_call_id: b.batch_call_id,
      name: b.name,
      from_number: b.from_number,
      agent_id: b.agent_id,
      agent_name: b.agent_name,
      total: b.total,
      skipped: b.skipped,
      scheduled_at: new Date(b.scheduled_at).toISOString(),
      created_at: new Date(b.created_at).toISOString(),
      call_window: b.window,
    },
  });
}
