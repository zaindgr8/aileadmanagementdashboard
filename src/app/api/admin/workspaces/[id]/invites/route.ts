import { NextResponse } from "next/server";
import { MODULES, type ModuleKey, type Role } from "@/lib/auth/modules";
import { body, fail, originOf, requirePlatformAdmin, sameOrigin } from "@/lib/tenant/api";
import { createInvite, EMAIL, inviteUrl } from "@/lib/tenant/invites";
import { getWorkspace } from "@/lib/tenant/workspaces";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// A new invite link for any workspace (e.g. a fresh owner link when the first one expired).
export async function POST(req: Request, { params }: Ctx) {
  const g = await requirePlatformAdmin();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const ws = await getWorkspace((await params).id);
  if (!ws) return fail("Workspace not found.", 404);
  const b = await body<{ email: string; name: string; role: Role; modules: string[] }>(req);
  const email = String(b.email ?? "").trim().toLowerCase();
  if (email && !EMAIL.test(email)) return fail("That email doesn't look right.");
  const role: Role = b.role === "admin" || b.role === "member" ? b.role : "owner";
  const modules = (b.modules ?? ws.modules).filter((m): m is ModuleKey => (MODULES as readonly string[]).includes(m) && ws.modules.includes(m as ModuleKey));
  const { invite, token } = await createInvite({ workspaceId: ws.id, email, name: String(b.name ?? ""), role, modules: modules.length ? modules : ws.modules, createdBy: g.user.username });
  return NextResponse.json({ invite, link: inviteUrl(originOf(req), token) });
}
