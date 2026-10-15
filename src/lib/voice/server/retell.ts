import { randomUUID } from 'node:crypto';
import type { Agent, CallDetail, Concurrency, LeanCall, PhoneNumber } from '@/lib/voice/types';
import { HttpError } from './http';

const RETELL = 'https://api.retellai.com';
export const MAX_CALLS_PER_RANGE = 20000;
export const E164 = /^\+[1-9]\d{6,14}$/;

const allowed = () =>
  new Set((process.env.ALLOWED_AGENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
export const agentAllowed = (id?: string) => {
  const set = allowed();
  return set.size === 0 || (!!id && set.has(id));
};
export const isRestricted = () => allowed().size > 0;

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Retell payloads */
async function retell<T = any>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new HttpError(500, 'RETELL_API_KEY is not set');
  const res = await fetch(RETELL + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
    cache: 'no-store',
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error_message: text }; }
  if (!res.ok) {
    throw new HttpError(res.status >= 500 ? 502 : res.status, data.error_message || data.message || `Retell error ${res.status}`);
  }
  return data as T;
}

// Small in-process TTL cache so dashboard refreshes don't hammer Retell.
const cache = new Map<string, { value: unknown; exp: number }>();
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value as T;
  const value = await fn();
  const now = Date.now();
  // Drop expired entries so keys that are never asked for again don't pile up.
  if (cache.size > 200) cache.forEach((v, k) => v.exp <= now && cache.delete(k));
  cache.set(key, { value, exp: now + ttlMs });
  return value;
}
export const clearCallCache = () => cache.forEach((_, k) => k.startsWith('calls:') && cache.delete(k));

export function listAgents(): Promise<Agent[]> {
  return cached('agents', 60_000, async () => {
    const out: any[] = [];
    let pagination_key: string | undefined;
    do {
      const q = new URLSearchParams({ limit: '1000', ...(pagination_key ? { pagination_key } : {}) });
      const page = await retell(`/v2/list-agents?${q}`, {
        method: 'POST',
        body: { filter_criteria: { channel: { type: 'string', op: 'eq', value: 'voice' } } },
      });
      out.push(...page.items);
      pagination_key = page.has_more ? page.pagination_key : undefined;
    } while (pagination_key);
    return out
      .filter((a) => agentAllowed(a.agent_id))
      .map((a) => ({
        agent_id: a.agent_id,
        agent_name: a.agent_name || 'Untitled agent',
        voice_name: a.voice_name,
        voice_avatar_url: a.voice_avatar_url,
        published_version: a.latest_published_version,
      }))
      .sort((a, b) => a.agent_name.localeCompare(b.agent_name));
  });
}

export function listPhoneNumbers(): Promise<PhoneNumber[]> {
  return cached('phones', 60_000, async () => {
    const page = await retell('/v2/list-phone-numbers?limit=1000');
    return page.items.map((p: any) => ({
      phone_number: p.phone_number,
      pretty: p.phone_number_pretty || p.phone_number,
      nickname: p.nickname,
      outbound_agent_id: p.outbound_agents?.[0]?.agent_id,
    }));
  });
}

export const getConcurrency = () => retell<Concurrency>('/get-concurrency').catch(() => null);

export function leanCall(c: any): LeanCall {
  const a = c.call_analysis || {};
  return {
    id: c.call_id,
    type: c.call_type,
    agent_id: c.agent_id,
    agent_name: c.agent_name,
    status: c.call_status,
    start: c.start_timestamp,
    end: c.end_timestamp,
    duration_ms: c.duration_ms || 0,
    reason: c.disconnection_reason,
    cost_cents: c.call_cost?.combined_cost || 0,
    from: c.from_number,
    to: c.to_number,
    direction: c.direction,
    batch_call_id: c.batch_call_id,
    sentiment: a.user_sentiment,
    successful: a.call_successful,
    voicemail: a.in_voicemail,
    summary: a.call_summary,
    custom: a.custom_analysis_data,
    vars: c.retell_llm_dynamic_variables,
    latency_p50: c.latency?.e2e?.p50,
  };
}

export function baseFilter(): Record<string, unknown> {
  const set = allowed();
  return set.size ? { agent: [...set].map((agent_id) => ({ agent_id })) } : {};
}

export async function listCalls(filter_criteria: Record<string, unknown>): Promise<LeanCall[]> {
  const out: LeanCall[] = [];
  let pagination_key: string | undefined;
  do {
    const page = await retell('/v3/list-calls', {
      method: 'POST',
      body: { filter_criteria, limit: 1000, sort_order: 'descending', ...(pagination_key ? { pagination_key } : {}) },
    });
    out.push(...page.items.map(leanCall));
    pagination_key = page.has_more && out.length < MAX_CALLS_PER_RANGE ? page.pagination_key : undefined;
  } while (pagination_key);
  return out;
}

export async function getCall(id: string): Promise<CallDetail> {
  const c = await retell(`/v2/get-call/${encodeURIComponent(id)}`);
  if (!agentAllowed(c.agent_id)) throw new HttpError(404, 'Call not found');
  return {
    ...leanCall(c),
    analysis: c.call_analysis,
    recording_url: c.recording_url,
    transcript: (c.transcript_object || []).map((t: any) => ({ role: t.role, content: t.content, at: t.words?.[0]?.start })),
    cost_breakdown: c.call_cost?.product_costs,
  };
}

export function createPhoneCall(input: { from_number: string; to_number: string; agent_id?: string; variables: Record<string, string> }) {
  return retell<{ call_id: string; call_status: string }>('/v2/create-phone-call', {
    method: 'POST',
    body: {
      from_number: input.from_number,
      to_number: input.to_number,
      idempotency_key: randomUUID(),
      ...(input.agent_id ? { override_agent_id: input.agent_id } : {}),
      retell_llm_dynamic_variables: input.variables,
      metadata: { source: 'ai-lead-dashboard' },
    },
  });
}

export function createBatchCall(body: Record<string, unknown>) {
  return retell<{ batch_call_id: string; name: string; total_task_count?: number }>('/create-batch-call', { method: 'POST', body });
}

/** Throws unless the caller ID belongs to the account and an allowed agent will handle the call. */
export async function assertCallable(from_number: string, agent_id?: string) {
  const phones = await listPhoneNumbers();
  const phone = phones.find((p) => p.phone_number === from_number);
  if (!phone) throw new HttpError(400, 'Choose a caller ID number from your account.');
  if (agent_id) {
    const agents = await listAgents();
    if (!agents.some((a) => a.agent_id === agent_id)) throw new HttpError(400, 'That agent is not available.');
  } else if (!phone.outbound_agent_id || !agentAllowed(phone.outbound_agent_id)) {
    throw new HttpError(400, 'Pick an agent for this call.');
  }
}

export const cleanVars = (v: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
      .filter(([k]) => k.trim())
      .map(([k, val]) => [k.trim(), String(val ?? '')]),
  );

export const normalizeTo = (n: unknown) => String(n ?? '').replace(/[\s()-]/g, '');
