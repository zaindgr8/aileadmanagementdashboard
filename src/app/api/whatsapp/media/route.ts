import { twilioFor } from "@/lib/whatsapp/twilio";

export const dynamic = "force-dynamic";

// Twilio media URLs need account auth; proxy them so images/voice notes render in the dashboard.
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") || "";
  let target: URL;
  try { target = new URL(raw); } catch { return new Response("Bad url", { status: 400 }); }
  if (target.protocol !== "https:" || target.hostname !== "api.twilio.com") return new Response("Forbidden", { status: 403 });

  // Only media from this workspace's own Twilio account.
  const t = await twilioFor();
  if (!t || !target.pathname.startsWith(`/2010-04-01/Accounts/${t.creds.accountSid}/`)) return new Response("Forbidden", { status: 403 });
  const auth = Buffer.from(`${t.creds.accountSid}:${t.creds.authToken}`).toString("base64");
  const res = await fetch(target, { headers: { Authorization: `Basic ${auth}` }, redirect: "follow" });
  if (!res.ok) return new Response("Media unavailable", { status: res.status });
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("content-type") || "application/octet-stream", "Cache-Control": "private, max-age=86400" },
  });
}
