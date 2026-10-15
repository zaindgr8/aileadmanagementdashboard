import { json, readJson, route } from '@/lib/voice/server/http';
import { deleteLead, leadDetail, phoneParam, updateLead } from '@/lib/voice/server/leads';
import { LeadFields, parse } from '@/lib/voice/server/validate';

type Ctx = RouteContext<'/api/voice/leads/[phone]'>;

export const GET = route<Ctx>(async (_req, ctx) => json(await leadDetail(phoneParam((await ctx.params).phone))));

export const PATCH = route<Ctx>(async (req, ctx) => {
  const phone = phoneParam((await ctx.params).phone);
  await updateLead(phone, parse(LeadFields, await readJson(req)));
  return json(await leadDetail(phone));
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  await deleteLead(phoneParam((await ctx.params).phone));
  return json({ ok: true });
});
