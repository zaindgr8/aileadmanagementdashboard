export const dynamic = "force-dynamic";

// Twilio media URLs need account auth; proxy them so images/voice notes render in the dashboard.
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") || "";
  let target: URL;
  try { target = new URL(raw); } catch { return new Response("Bad url", { status: 400 }); }
  if (target.protocol !== "https:" || target.hostname !== "api.twilio.com") return new Response("Forbidden", { status: 403 });

  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(target, { headers: { Authorization: `Basic ${auth}` }, redirect: "follow" });
  if (!res.ok) return new Response("Media unavailable", { status: res.status });
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("content-type") || "application/octet-stream", "Cache-Control": "private, max-age=86400" },
  });
}
