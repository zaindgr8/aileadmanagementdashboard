import { NextResponse } from "next/server";
import { originOf, requireManager } from "@/lib/tenant/api";
import { authorizeUrl, instagramAppConfigured } from "@/lib/instagram/api";
import { makeState } from "@/lib/instagram/connect";

export const dynamic = "force-dynamic";

// "Connect Instagram": send the owner/admin to Instagram's login, then back to /api/instagram/callback.
export async function GET(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  const back = new URL("/settings", originOf(req));
  if (!instagramAppConfigured()) {
    back.searchParams.set("ig_error", "The Instagram app isn't set up on the server yet.");
    return NextResponse.redirect(back);
  }
  const redirectUri = `${originOf(req)}/api/instagram/callback`;
  return NextResponse.redirect(authorizeUrl(redirectUri, makeState(g.user.workspace, g.user.username)));
}
