import { NextResponse } from "next/server";
import { MODULES, type ModuleKey } from "@/lib/auth/modules";
import { body, fail, originOf, requirePlatformAdmin, sameOrigin } from "@/lib/tenant/api";
import { createInvite, EMAIL, inviteUrl } from "@/lib/tenant/invites";
import { workspaceSummaries } from "@/lib/tenant/onboarding";
import { createWorkspace, publicInfo } from "@/lib/tenant/workspaces";
import { PLANS } from "@/lib/tenant/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requirePlatformAdmin();
  if ("response" in g) return g.response;
  return NextResponse.json(await workspaceSummaries());
}

// Onboard a client: create an approved workspace and an invite link for its owner.
export async function POST(req: Request) {
  const g = await requirePlatformAdmin();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const b = await body<{ name: string; contactName: string; contactEmail: string; modules: string[]; plan: string }>(req);
  const name = String(b.name ?? "").trim();
  const email = String(b.contactEmail ?? "").trim().toLowerCase();
  if (name.length < 2) return fail("Enter the client's company or brand name.");
  if (email && !EMAIL.test(email)) return fail("That email doesn't look right.");
  const modules = (b.modules ?? []).filter((m): m is ModuleKey => (MODULES as readonly string[]).includes(m));
  if (!modules.length) return fail("Pick at least one module.");
  const plan = (PLANS as readonly string[]).includes(String(b.plan)) ? String(b.plan) : "starter";

  const ws = await createWorkspace({
    name, status: "active", modules, plan, contactName: String(b.contactName ?? "").trim(), contactEmail: email, approvedBy: g.user.username,
  });
  const { invite, token } = await createInvite({
    workspaceId: ws.id, email, name: String(b.contactName ?? "").trim(), role: "owner", modules, createdBy: g.user.username,
  });
  return NextResponse.json({ workspace: publicInfo(ws), invite, link: inviteUrl(originOf(req), token) });
}
