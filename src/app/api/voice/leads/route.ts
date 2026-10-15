import { z } from 'zod';
import { buildLeads, byPriority } from '@/lib/voice/leads';
import { json, readJson, route, HttpError } from '@/lib/voice/server/http';
import { leadCalls, mergeLeads, phoneParam, readLeads } from '@/lib/voice/server/leads';
import { LeadFields, parse } from '@/lib/voice/server/validate';

export const GET = route(async (req) => {
  const showArchived = req.nextUrl.searchParams.get('archived') === '1';
  const [records, calls] = await Promise.all([readLeads(), leadCalls()]);
  const leads = buildLeads(records, calls).filter((l) => l.archived === showArchived).sort(byPriority);
  return json({ leads, generated_at: Date.now() });
});

const Import = z.object({
  leads: z.array(LeadFields.extend({ phone: z.string() })).min(1).max(5000),
  source: z.string().trim().max(120).optional(),
});

/** Create one lead or import many. Existing leads only get their blank fields filled. */
export const POST = route(async (req) => {
  const body = parse(Import, await readJson(req));
  const items = body.leads.map((l) => {
    try {
      return { ...l, phone: phoneParam(l.phone), source: l.source || body.source || 'Manual' };
    } catch {
      return null;
    }
  }).filter((l) => l !== null);
  if (!items.length) throw new HttpError(400, 'No valid phone numbers. Use international format like +971501234567.');
  const res = await mergeLeads(items);
  return json({ ...res, skipped: body.leads.length - items.length }, { status: 201 });
});
