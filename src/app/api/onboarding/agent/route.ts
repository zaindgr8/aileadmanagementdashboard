import { NextResponse } from "next/server";
import { body, fail, requirePlatformAdmin, sameOrigin } from "@/lib/tenant/api";
import { getWorkspace, updateWorkspace } from "@/lib/tenant/workspaces";
import { inWorkspace } from "@/lib/tenant/context";
import { updateSettings } from "@/lib/whatsapp/store";

export const dynamic = "force-dynamic";

// Platform admins mark a client's agent as built and live (switches the agent on), or take it back.
export async function POST(req: Request) {
  const g = await requirePlatformAdmin();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const { live } = await body<{ live: boolean }>(req);
  const ws = await getWorkspace(g.user.workspace);
  if (!ws) return fail("Workspace not found.", 404);
  await updateWorkspace(ws.id, { onboarding: live ? { agentLiveAt: new Date().toISOString(), agentLiveBy: g.user.username } : { agentLiveAt: undefined, agentLiveBy: undefined } });
  if (live) await inWorkspace(ws.id, () => updateSettings({ agentEnabled: true }));
  return NextResponse.json({ ok: true, live: Boolean(live) });
}
