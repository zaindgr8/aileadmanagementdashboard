import { NextResponse } from "next/server";
import { body, fail, requireManager, sameOrigin } from "@/lib/tenant/api";
import { getWorkspace, retellCreds, twilioCreds } from "@/lib/tenant/workspaces";
import { testTwilio } from "@/lib/whatsapp/twilio";

export const dynamic = "force-dynamic";

// "Test connection": check the keys work before (or after) saving them. Values typed in the form
// are used when given; anything left blank falls back to what's saved.
export async function POST(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const ws = await getWorkspace(g.user.workspace);
  if (!ws) return fail("Workspace not found.", 404);
  const b = await body<{ kind: "twilio" | "retell"; twilioAccountSid: string; twilioAuthToken: string; twilioMessagingServiceSid: string; retellApiKey: string }>(req);
  const t = (v: unknown) => String(v ?? "").trim();

  if (b.kind === "twilio") {
    const saved = twilioCreds(ws);
    const accountSid = t(b.twilioAccountSid) || saved?.accountSid || ws.config.twilioAccountSid || "";
    const authToken = t(b.twilioAuthToken) || saved?.authToken || ws.secrets.twilioAuthToken || "";
    if (!accountSid || !authToken) return fail("Enter the Account SID and auth token first.");
    try {
      const r = await testTwilio({ accountSid, authToken, messagingServiceSid: t(b.twilioMessagingServiceSid) || saved?.messagingServiceSid });
      return NextResponse.json({ ok: true, detail: `Connected to “${r.account}” (${r.status})${r.sender ? ` · sender “${r.sender}”` : ""}` });
    } catch (err) {
      const status = (err as { status?: number }).status;
      return fail(status === 401 ? "Twilio rejected these credentials." : `Twilio: ${err instanceof Error ? err.message : String(err)}`, 400);
    }
  }

  if (b.kind === "retell") {
    const apiKey = t(b.retellApiKey) || retellCreds(ws)?.apiKey || "";
    if (!apiKey) return fail("Enter the Retell API key first.");
    const res = await fetch("https://api.retellai.com/v2/list-phone-numbers?limit=100", {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000), cache: "no-store",
    }).catch((err) => err as Error);
    if (res instanceof Error) return fail(`Couldn't reach Retell: ${res.message}`);
    if (res.status === 401 || res.status === 403) return fail("Retell rejected this API key.");
    if (!res.ok) return fail(`Retell returned HTTP ${res.status}.`);
    const data = (await res.json().catch(() => ({}))) as { items?: unknown[] };
    const n = data.items?.length ?? 0;
    return NextResponse.json({ ok: true, detail: `Connected · ${n} phone number${n === 1 ? "" : "s"} on this account` });
  }

  return fail("Unknown connection.");
}
