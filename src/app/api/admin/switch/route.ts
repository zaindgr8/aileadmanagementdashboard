import { NextResponse, type NextRequest } from "next/server";
import { withSession } from "@/lib/auth/session";
import { body, fail, requirePlatformAdmin, sameOrigin } from "@/lib/tenant/api";
import { getWorkspace } from "@/lib/tenant/workspaces";

export const dynamic = "force-dynamic";

// Platform admins can open any workspace to set it up or help a client; they act as its owner.
export async function POST(req: NextRequest) {
  const g = await requirePlatformAdmin();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const { workspaceId } = await body<{ workspaceId: string }>(req);
  const ws = workspaceId ? await getWorkspace(String(workspaceId)) : null;
  if (!ws) return fail("Workspace not found.", 404);
  const user = { ...g.user, role: "owner" as const, modules: ws.modules, workspace: ws.id, workspaceName: ws.name };
  return withSession(req, NextResponse.json({ ok: true, workspace: { id: ws.id, name: ws.name } }), user);
}
