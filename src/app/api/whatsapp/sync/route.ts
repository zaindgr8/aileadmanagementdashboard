import { NextResponse } from "next/server";
import { importHistory, twilioConfigured } from "@/lib/whatsapp/twilio";

export const dynamic = "force-dynamic";

// Pull past WhatsApp messages from Twilio's message log.
export async function POST(req: Request) {
  if (!twilioConfigured) return NextResponse.json({ error: "Connect Twilio first (see .env.example)." }, { status: 400 });
  const { limit = 1000 } = (await req.json().catch(() => ({}))) as { limit?: number };
  try {
    return NextResponse.json({ imported: await importHistory(Math.min(limit, 5000)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 502 });
  }
}
