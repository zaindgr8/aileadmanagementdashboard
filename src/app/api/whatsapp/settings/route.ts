import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/whatsapp/store";
import { aiConfigured } from "@/lib/whatsapp/agent";
import { PUBLIC_BASE_URL, WHATSAPP_FROM, twilioConfigured } from "@/lib/whatsapp/twilio";
import type { Settings } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

function env() {
  return { twilioConfigured, aiConfigured, whatsappFrom: WHATSAPP_FROM, publicBaseUrl: PUBLIC_BASE_URL, demo: !twilioConfigured };
}

export async function GET() {
  return NextResponse.json({ settings: await getSettings(), env: env() });
}

export async function PUT(req: Request) {
  const patch = (await req.json()) as Partial<Settings>;
  return NextResponse.json({ settings: await updateSettings(patch), env: env() });
}
