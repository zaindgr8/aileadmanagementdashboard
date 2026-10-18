import { NextResponse, type NextRequest } from "next/server";
import { withSession } from "@/lib/auth/session";
import { recordFailedAttempt, tooManyAttempts } from "@/lib/auth/users";
import { body, fail, sameOrigin } from "@/lib/tenant/api";
import { acceptInvite, openInvite } from "@/lib/tenant/invites";
import { getWorkspace } from "@/lib/tenant/workspaces";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ token: string }> };

// What the invite is for, so the page can greet the person.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const r = await openInvite((await params).token);
  if ("error" in r) return fail(r.error, 404);
  return NextResponse.json({
    workspace: r.workspace.name, email: r.invite.email, name: r.invite.name, role: r.invite.role,
    modules: r.invite.modules, pending: r.workspace.status === "pending", expiresAt: r.invite.expiresAt,
  });
}

// Accept: create the account and sign in.
export async function POST(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (tooManyAttempts(ip)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const b = await body<{ username: string; name: string; password: string; email: string }>(req);
  const r = await acceptInvite((await params).token, {
    username: String(b.username ?? ""), name: String(b.name ?? ""), password: String(b.password ?? ""), email: String(b.email ?? ""),
  });
  if ("error" in r) {
    recordFailedAttempt(ip);
    return fail(r.error ?? "Couldn't accept the invite.");
  }
  // A workspace still waiting for approval can't be used yet: create the account, but don't sign in.
  if ((await getWorkspace(r.user.workspace))?.status !== "active") return NextResponse.json({ ok: true, pending: true });
  return withSession(req, NextResponse.json({ ok: true, pending: false }), r.user);
}
