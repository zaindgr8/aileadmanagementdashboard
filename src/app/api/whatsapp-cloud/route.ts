import { NextResponse } from "next/server";
import { fail, originOf, requireManager, requireUser, sameOrigin } from "@/lib/tenant/api";
import { embeddedSignupConfig, metaApp, webhookVerifyToken } from "@/lib/whatsapp-cloud/api";
import { disconnectCloud } from "@/lib/whatsapp-cloud/connect";
import { getWorkspace } from "@/lib/tenant/workspaces";

export const dynamic = "force-dynamic";

// WhatsApp (Meta Embedded Signup) status for the Connections page and Get started.
export async function GET(req: Request) {
  const g = await requireUser();
  if ("response" in g) return g.response;
  const ws = await getWorkspace(g.user.workspace);
  if (!ws) return fail("Workspace not found.", 404);
  return NextResponse.json({
    appConfigured: Boolean(metaApp()),
    signup: embeddedSignupConfig(),
    account: ws.config.whatsappCloud ?? null,
    ...(g.user.platformAdmin ? {
      setup: { callbackUrl: `${originOf(req)}/api/webhooks/whatsapp-cloud`, verifyToken: webhookVerifyToken(), domain: new URL(originOf(req)).host },
    } : {}),
  });
}

export async function DELETE(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  await disconnectCloud(g.user.workspace);
  return NextResponse.json({ ok: true });
}
