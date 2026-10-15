import { json, route, HttpError } from '@/lib/voice/server/http';
import { getCall } from '@/lib/voice/server/retell';

export const GET = route<RouteContext<'/api/voice/calls/[id]'>>(async (_req, ctx) => {
  const { id } = await ctx.params;
  if (!/^[\w-]+$/.test(id)) throw new HttpError(400, 'Invalid call id');
  return json(await getCall(id));
});
