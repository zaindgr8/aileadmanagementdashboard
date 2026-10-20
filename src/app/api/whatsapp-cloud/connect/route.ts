import { NextResponse } from "next/server";
import { body, fail, requireManager, sameOrigin } from "@/lib/tenant/api";
import { connectFromSignup } from "@/lib/whatsapp-cloud/connect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Embedded Signup pop-up finished: the browser sends the code (and, usually, the WABA and phone number ids).
export async function POST(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const b = await body<{ code: string; wabaId: string; phoneNumberId: string }>(req);
  const code = String(b.code ?? "").trim();
  if (!code) return fail("WhatsApp didn't return a login code. Please try again.");
  const clean = (v: unknown) => (/^\d{5,25}$/.test(String(v ?? "")) ? String(v) : undefined);
  try {
    const phone = await connectFromSignup(g.user.workspace, { code, wabaId: clean(b.wabaId), phoneNumberId: clean(b.phoneNumberId) }, g.user.username);
    return NextResponse.json({ ok: true, phone });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Couldn't connect WhatsApp.", 400);
  }
}
