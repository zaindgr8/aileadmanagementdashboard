import { NextResponse } from "next/server";
import { listTemplates, twilioConfigured } from "@/lib/whatsapp/twilio";

export const dynamic = "force-dynamic";

// Approved WhatsApp templates (Twilio Content API) — needed to message outside the 24h window.
export async function GET() {
  if (!twilioConfigured) return NextResponse.json([]);
  try {
    return NextResponse.json(await listTemplates());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
