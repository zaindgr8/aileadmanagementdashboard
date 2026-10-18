import { json, readJson, route, HttpError } from '@/lib/voice/server/http';
import { isAnswered } from '@/lib/voice/calls';
import { readBatches, saveBatch } from '@/lib/voice/server/batches';
import { leadNameFrom, mergeLeads } from '@/lib/voice/server/leads';
import {
  assertCallable, baseFilter, cached, cleanVars, createBatchCall, E164, listAgents, listCalls, normalizeTo,
} from '@/lib/voice/server/retell';
import type { Batch, CallTimeWindow } from '@/lib/voice/types';

const MAX_TASKS = 5000;

export const GET = route(async () => {
  const batches = await readBatches();
  // Pull live progress for the most recent campaigns.
  const withStats = await Promise.all(batches.slice(0, 25).map(async (b): Promise<Batch> => {
    try {
      const calls = await cached(`batch:${b.batch_call_id}`, 20_000, async () =>
        listCalls({ ...(await baseFilter()), batch_call_id: { type: 'string', op: 'eq', value: b.batch_call_id } }));
      const by = (s: string) => calls.filter((c) => c.status === s).length;
      return {
        ...b,
        placed: calls.length,
        ended: by('ended'),
        answered: calls.filter(isAnswered).length,
        ongoing: by('ongoing') + by('registered'),
        not_connected: by('not_connected') + by('error'),
        successful: calls.filter((c) => c.successful).length,
        cost_cents: calls.reduce((s, c) => s + c.cost_cents, 0),
      };
    } catch {
      return { ...b, statsError: true };
    }
  }));
  return json({ batches: [...withStats, ...batches.slice(25)] });
});

interface BatchInput {
  name?: string;
  from_number?: string;
  agent_id?: string;
  trigger_timestamp?: number;
  tasks?: { to_number?: string; variables?: unknown }[];
  window?: { start?: number; end?: number; timezone?: string; days?: string[] };
}

export const POST = route(async (req) => {
  const { name, from_number, agent_id, trigger_timestamp, tasks, window } = await readJson<BatchInput>(req);
  if (!Array.isArray(tasks) || tasks.length === 0) throw new HttpError(400, 'Add at least one contact.');
  if (tasks.length > MAX_TASKS) throw new HttpError(400, `A campaign can hold up to ${MAX_TASKS} contacts.`);
  const from = String(from_number ?? '');
  await assertCallable(from, agent_id || undefined);

  const seen = new Set<string>();
  const clean = [];
  for (const t of tasks) {
    const to = normalizeTo(t.to_number);
    if (!E164.test(to) || seen.has(to)) continue;
    seen.add(to);
    clean.push({
      to_number: to,
      ...(agent_id ? { override_agent_id: agent_id } : {}),
      retell_llm_dynamic_variables: cleanVars(t.variables),
      metadata: { source: 'ai-lead-dashboard' },
    });
  }
  if (!clean.length) throw new HttpError(400, 'No valid phone numbers found. Use international format like +971501234567.');

  let call_time_window: CallTimeWindow | undefined;
  if (window?.start != null && window?.end != null) {
    const start = Number(window.start), end = Number(window.end);
    if (!(start >= 0 && end <= 1440 && start < end)) throw new HttpError(400, 'Calling hours must start before they end.');
    call_time_window = {
      windows: [{ start, end }],
      timezone: window.timezone || 'Asia/Dubai',
      ...(Array.isArray(window.days) && window.days.length ? { day: window.days } : {}),
    };
  }

  const ts = Number(trigger_timestamp);
  const scheduled = ts > Date.now();
  const batch = await createBatchCall({
    name: String(name || `Campaign ${new Date().toISOString().slice(0, 10)}`).slice(0, 120),
    from_number: from,
    tasks: clean,
    ...(scheduled ? { trigger_timestamp: ts } : {}),
    ...(call_time_window ? { call_time_window } : {}),
  });
  const agents = await listAgents();
  const entry: Batch = {
    batch_call_id: batch.batch_call_id,
    name: batch.name,
    from_number: from,
    agent_id: agent_id || null,
    agent_name: agents.find((a) => a.agent_id === agent_id)?.agent_name ?? null,
    total: batch.total_task_count ?? clean.length,
    skipped: tasks.length - clean.length,
    scheduled_at: scheduled ? ts : Date.now(),
    created_at: Date.now(),
    window: call_time_window ?? null,
  };
  await saveBatch(entry);
  await mergeLeads(clean.map((t) => ({
    phone: t.to_number, name: leadNameFrom(t.retell_llm_dynamic_variables), source: `Campaign: ${entry.name}`,
  }))).catch((e) => console.error('lead save failed', e));
  return json(entry, { status: 201 });
});
