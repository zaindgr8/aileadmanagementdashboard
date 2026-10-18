import 'server-only';
import { randomUUID } from 'node:crypto';
import { normalizePhone } from '@/lib/voice/calls';
import { buildLead, callsByContact } from '@/lib/voice/leads';
import type { LeadBrief, LeadDetail, LeadNote, LeadRecord, LeanCall } from '@/lib/voice/types';
import { q, qList, sb, sbAll } from '@/lib/supabase';
import { HttpError } from './http';
import { baseFilter, cached, E164, listCalls } from './retell';
import { workspaceId, wsFilter } from '@/lib/tenant/context';

// Call leads live in Supabase (`call_leads`, see supabase/schema.sql), next to the WhatsApp data.
type Leads = Record<string, LeadRecord>;

/** How far back calls count toward a lead's history and score. */
export const LEAD_WINDOW_DAYS = 180;

// ---------- row mapping (the app works in ms timestamps; the table uses timestamptz) ----------
interface LeadRow {
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  stage: LeadRecord['stage'] | null;
  stage_at: string | null;
  value: number | null;
  tags: string[];
  notes: LeadNote[];
  follow_up_at: string | null;
  source: string | null;
  archived: boolean;
  brief: LeadBrief | null;
  created_at: string;
  updated_at: string | null;
}

const ms = (v: string | null) => (v ? new Date(v).getTime() : undefined);
const ts = (v: number | null | undefined) => (v ? new Date(v).toISOString() : null);

function toRecord(r: LeadRow): LeadRecord {
  const rec: LeadRecord = { phone: r.phone, created_at: ms(r.created_at)! };
  if (r.name) rec.name = r.name;
  if (r.email) rec.email = r.email;
  if (r.company) rec.company = r.company;
  if (r.stage) rec.stage = r.stage;
  if (r.stage_at) rec.stage_at = ms(r.stage_at);
  if (r.value != null) rec.value = Number(r.value);
  if (r.tags?.length) rec.tags = r.tags;
  if (r.notes?.length) rec.notes = r.notes;
  rec.follow_up_at = ms(r.follow_up_at) ?? null;
  if (r.source) rec.source = r.source;
  if (r.archived) rec.archived = true;
  if (r.brief) rec.brief = r.brief;
  if (r.updated_at) rec.updated_at = ms(r.updated_at);
  return rec;
}

function toRow(rec: LeadRecord, workspace_id: string): LeadRow & { workspace_id: string } {
  return {
    workspace_id,
    phone: rec.phone,
    name: rec.name ?? null,
    email: rec.email ?? null,
    company: rec.company ?? null,
    stage: rec.stage ?? null,
    stage_at: ts(rec.stage_at),
    value: rec.value ?? null,
    tags: rec.tags ?? [],
    notes: rec.notes ?? [],
    follow_up_at: ts(rec.follow_up_at),
    source: rec.source ?? null,
    archived: !!rec.archived,
    brief: rec.brief ?? null,
    created_at: ts(rec.created_at)!,
    updated_at: ts(rec.updated_at ?? Date.now()),
  };
}

async function upsert(recs: LeadRecord[]) {
  const ws = await workspaceId();
  for (let i = 0; i < recs.length; i += 500) {
    await sb('call_leads?on_conflict=workspace_id,phone', { method: 'POST', body: recs.slice(i, i + 500).map((r) => toRow(r, ws)), prefer: 'resolution=merge-duplicates' });
  }
}

async function getRecord(phone: string): Promise<LeadRecord | undefined> {
  const rows = await sb<LeadRow[]>(`call_leads?${await wsFilter()}&phone=eq.${q(phone)}&select=*`);
  return rows[0] ? toRecord(rows[0]) : undefined;
}

async function getRecords(phones: string[]): Promise<Leads> {
  const out: Leads = {};
  const w = await wsFilter();
  for (let i = 0; i < phones.length; i += 150) {
    const chunk = phones.slice(i, i + 150);
    const rows = await sb<LeadRow[]>(`call_leads?${w}&select=*&phone=in.(${chunk.map(qList).join(',')})`);
    for (const r of rows) out[r.phone] = toRecord(r);
  }
  return out;
}

export async function readLeads(): Promise<Leads> {
  const rows = await sbAll<LeadRow>(`call_leads?${await wsFilter()}&select=*&order=phone.asc`);
  return Object.fromEntries(rows.map((r) => [r.phone, toRecord(r)]));
}

/** Calls used to build the pipeline. Key starts with `calls:` so placing a call clears it. */
export function leadCalls(): Promise<LeanCall[]> {
  return cached('calls:leads', 30_000, async () => {
    const end = Date.now();
    return listCalls({ ...(await baseFilter()), start_timestamp: { type: 'range', op: 'bt', value: [end - LEAD_WINDOW_DAYS * 86400_000, end] } });
  });
}

/** Parses a phone from a URL segment or form, or throws a 400. */
export function phoneParam(raw: string) {
  const phone = normalizePhone(decodeURIComponent(raw));
  if (!E164.test(phone)) throw new HttpError(400, 'Invalid phone number');
  return phone;
}

/** First non-empty `*name*` variable, e.g. customer_name. */
export function leadNameFrom(vars: Record<string, string>) {
  const key = Object.keys(vars).find((k) => /name/i.test(k) && !/agent|company|business/i.test(k) && vars[k].trim());
  return key ? vars[key].trim().slice(0, 120) : undefined;
}

const blank = (phone: string): LeadRecord => ({ phone, created_at: Date.now() });

export type LeadPatch = Partial<Pick<LeadRecord, 'name' | 'email' | 'company' | 'stage' | 'value' | 'tags' | 'follow_up_at' | 'source' | 'archived'>>;

export async function updateLead(phone: string, patch: LeadPatch) {
  const rec = (await getRecord(phone)) ?? blank(phone);
  if (patch.stage && patch.stage !== rec.stage) rec.stage_at = Date.now();
  Object.assign(rec, patch, { updated_at: Date.now() });
  await upsert([rec]);
  return rec;
}

/**
 * Creates leads that don't exist yet and fills in blank fields on ones that do.
 * Never overwrites what a person has already entered.
 */
export async function mergeLeads(items: (LeadPatch & { phone: string })[]) {
  const all = await getRecords([...new Set(items.map((i) => i.phone))]);
  const changed = new Map<string, LeadRecord>();
  let created = 0, updated = 0;
  for (const { phone, ...fields } of items) {
    const rec = all[phone];
    if (!rec) {
      all[phone] = { ...blank(phone), ...fields, ...(fields.stage ? { stage_at: Date.now() } : {}) };
      changed.set(phone, all[phone]);
      created++;
      continue;
    }
    let dirty = false;
    for (const [k, v] of Object.entries(fields) as [keyof LeadPatch, unknown][]) {
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      if (k === 'tags') {
        const merged = [...new Set([...(rec.tags ?? []), ...(v as string[])])];
        if (merged.length !== (rec.tags ?? []).length) { rec.tags = merged; dirty = true; }
      } else if (rec[k] == null || rec[k] === '') {
        (rec as unknown as Record<string, unknown>)[k] = v;
        dirty = true;
      }
    }
    if (rec.archived) { rec.archived = false; dirty = true; } // re-imported: bring it back
    if (dirty && !changed.has(phone)) updated++;
    if (dirty) { rec.updated_at = Date.now(); changed.set(phone, rec); }
  }
  await upsert([...changed.values()]);
  return { created, updated };
}

export async function addNote(phone: string, text: string) {
  const rec = (await getRecord(phone)) ?? blank(phone);
  const note = { id: randomUUID(), at: Date.now(), text };
  rec.notes = [note, ...(rec.notes ?? [])].slice(0, 500);
  rec.updated_at = Date.now();
  await upsert([rec]);
  return note;
}

export async function deleteNote(phone: string, id: string) {
  const rec = await getRecord(phone);
  if (!rec?.notes) return;
  await sb(`call_leads?${await wsFilter()}&phone=eq.${q(phone)}`, { method: 'PATCH', body: { notes: rec.notes.filter((n) => n.id !== id), updated_at: new Date().toISOString() } });
}

export async function saveBrief(phone: string, brief: LeadBrief) {
  const rec = (await getRecord(phone)) ?? blank(phone);
  rec.brief = brief;
  await upsert([rec]);
}

export async function deleteLead(phone: string) {
  await sb(`call_leads?${await wsFilter()}&phone=eq.${q(phone)}`, { method: 'DELETE' });
}

export async function leadDetail(phone: string): Promise<LeadDetail> {
  const [rec, calls] = await Promise.all([getRecord(phone), leadCalls()]);
  const history = callsByContact(calls).get(phone) ?? [];
  if (!rec && !history.length) throw new HttpError(404, 'Lead not found');
  return { ...buildLead(phone, rec, history), notes: rec?.notes ?? [], history, brief: rec?.brief };
}
