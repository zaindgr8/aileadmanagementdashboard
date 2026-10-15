import { isAnswered } from '@/lib/voice/calls';
import { writeBrief } from '@/lib/voice/server/ai';
import { json, route, HttpError } from '@/lib/voice/server/http';
import { leadDetail, phoneParam, saveBrief } from '@/lib/voice/server/leads';
import { getCall } from '@/lib/voice/server/retell';

const MAX_CALLS = 6;

export const POST = route<RouteContext<'/api/voice/leads/[phone]/brief'>>(async (_req, ctx) => {
  const phone = phoneParam((await ctx.params).phone);
  const lead = await leadDetail(phone);
  const answered = lead.history.filter(isAnswered).slice(0, MAX_CALLS);
  if (!answered.length && !lead.notes.length) throw new HttpError(400, 'There are no conversations or notes to summarise yet.');
  const calls = await Promise.all(answered.map((c) => getCall(c.id)));
  await saveBrief(phone, await writeBrief(lead, lead.notes, calls, lead.calls));
  return json(await leadDetail(phone));
});
