import { NextResponse } from "next/server";
import { originOf, requireManager } from "@/lib/tenant/api";
import { exchangeCode } from "@/lib/instagram/api";
import { readState, saveConnection } from "@/lib/instagram/connect";

export const dynamic = "force-dynamic";

// Instagram sends the user back here after "Allow" (or "Cancel"). We swap the code for a
// long-lived token, save it to the workspace and turn on its webhooks, then return to Settings.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = new URL("/settings", originOf(req));
  const fail = (msg: string) => { back.searchParams.set("ig_error", msg); return NextResponse.redirect(back); };

  const g = await requireManager();
  if ("response" in g) return fail("Please sign in as a workspace owner or admin, then connect again.");
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") || "Instagram login was cancelled.");

  const state = readState(url.searchParams.get("state"));
  if (!state || state.w !== g.user.workspace) return fail("That login link expired or was for another workspace. Please try again.");
  const code = url.searchParams.get("code")?.replace(/#_$/, "");
  if (!code) return fail("Instagram didn't send a login code. Please try again.");

  try {
    const { token, expiresAt } = await exchangeCode(code, `${originOf(req)}/api/instagram/callback`);
    const me = await saveConnection(g.user.workspace, token, expiresAt, g.user.username);
    back.searchParams.set("ig", me.username);
    return NextResponse.redirect(back);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Couldn't connect Instagram.");
  }
}
