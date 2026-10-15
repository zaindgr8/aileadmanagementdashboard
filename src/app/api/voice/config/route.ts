import { json, route } from '@/lib/voice/server/http';
import { getConcurrency, isRestricted, listAgents, listPhoneNumbers } from '@/lib/voice/server/retell';
import { aiEnabled } from '@/lib/voice/server/ai';
import type { DashboardConfig } from '@/lib/voice/types';

export const GET = route(async () => {
  const [agents, phoneNumbers, concurrency] = await Promise.all([listAgents(), listPhoneNumbers(), getConcurrency()]);
  return json({ agents, phoneNumbers, concurrency, restricted: isRestricted(), aiEnabled: aiEnabled() } satisfies DashboardConfig);
});
