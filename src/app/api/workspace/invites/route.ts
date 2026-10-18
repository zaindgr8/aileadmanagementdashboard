import { NextResponse } from "next/server";
import { MODULES, type ModuleKey, type Role } from "@/lib/auth/modules";
import { body, fail, originOf, requireManager, sameOrigin } from "@/lib/tenant/api";
import { createInvite, EMAIL, inviteUrl, listInvites, revokeInvite } from "@/lib/tenant/invites";
import { getWorkspace } from "@/lib/tenant/workspaces";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireManager();
  if ("response" in g) return g.response;
  return NextResponse.json(await listInvites(g.user.workspace));
}

// Invite a teammate by link. Only owners can invite admins; modules are limited to the workspace's.
export async function POST(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const ws = await getWorkspace(g.user.workspace);
  if (!ws) return fail("Workspace not found.", 404);
  const b = await body<{ email: string; name: string; role: Role; modules: string[] }>(req);
  const email = String(b.email ?? "").trim().toLowerCase();
  if (email && !EMAIL.test(email)) return fail("That email doesn't look right.");
  const role: Role = b.role === "admin" && (g.user.role === "owner" || g.user.platformAdmin) ? "admin" : "member";
  const modules = (b.modules ?? ["whatsapp"]).filter((m): m is ModuleKey => (MODULES as readonly string[]).includes(m) && ws.modules.includes(m as ModuleKey));
  if (!modules.length) return fail("Pick at least one module.");
  const { invite, token } = await createInvite({ workspaceId: ws.id, email, name: String(b.name ?? ""), role, modules, createdBy: g.user.username });
  return NextResponse.json({ invite, link: inviteUrl(originOf(req), token) });
}

export async function DELETE(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return fail("Missing invite.");
  await revokeInvite(g.user.workspace, id);
  return NextResponse.json({ ok: true });
}
