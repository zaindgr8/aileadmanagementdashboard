import { NextResponse } from "next/server";
import { recordFailedAttempt, tooManyAttempts } from "@/lib/auth/users";
import { MODULES, type ModuleKey } from "@/lib/auth/modules";
import { body, fail, sameOrigin } from "@/lib/tenant/api";
import { signup } from "@/lib/tenant/onboarding";

export const dynamic = "force-dynamic";

// Public sign-up. Creates a workspace that waits for a platform admin to approve it.
// Turn it off with SIGNUP_ENABLED=false (then clients join through invite links only).
export async function POST(req: Request) {
  if (process.env.SIGNUP_ENABLED === "false") return fail("Sign-up is closed. Ask us for an invite link.", 403);
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (tooManyAttempts(ip)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  // Each sign-up counts towards the same per-IP limit as failed logins.
  recordFailedAttempt(ip);

  const b = await body<{ company: string; name: string; email: string; username: string; password: string; modules: string[] }>(req);
  const modules = (b.modules ?? []).filter((m): m is ModuleKey => (MODULES as readonly string[]).includes(m));
  const r = await signup({
    company: String(b.company ?? ""), name: String(b.name ?? ""), email: String(b.email ?? ""),
    username: String(b.username ?? ""), password: String(b.password ?? ""), modules,
  });
  if ("error" in r) return fail(r.error ?? "Couldn't sign up.");
  return NextResponse.json({ ok: true, workspace: { id: r.workspace.id, name: r.workspace.name, status: r.workspace.status } });
}
