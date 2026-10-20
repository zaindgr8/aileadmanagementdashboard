import { NextResponse } from "next/server";
import { fail, originOf, requireManager, requireUser, sameOrigin } from "@/lib/tenant/api";
import { instagramAppConfigured, webhookVerifyToken } from "@/lib/instagram/api";
import { disconnect } from "@/lib/instagram/connect";
import { getWorkspace } from "@/lib/tenant/workspaces";

export const dynamic = "force-dynamic";

// Instagram connection status for the Connections page.
export async function GET(req: Request) {
  const g = await requireUser();
  if ("response" in g) return g.response;
  const ws = await getWorkspace(g.user.workspace);
  if (!ws) return fail("Workspace not found.", 404);
  const base = originOf(req);
  return NextResponse.json({
    appConfigured: instagramAppConfigured(),
    account: ws.config.instagram ?? null,
    // The app-level webhook is set once in the Meta app, so only platform admins need these.
    ...(g.user.platformAdmin ? {
      setup: {
        callbackUrl: `${base}/api/webhooks/instagram`,
        verifyToken: webhookVerifyToken(),
        redirectUri: `${base}/api/instagram/callback`,
        httpsOk: base.startsWith("https://"),
      },
    } : {}),
  });
}

export async function DELETE(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  await disconnect(g.user.workspace);
  return NextResponse.json({ ok: true });
}
