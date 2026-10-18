import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/whatsapp/store";
import { aiConfigured } from "@/lib/whatsapp/agent";
import { publicBaseUrl, twilioFor } from "@/lib/whatsapp/twilio";
import type { Settings } from "@/lib/whatsapp/types";
import { currentUser } from "@/lib/auth/current";
import { geminiConfigured, GEMINI_MODEL } from "@/lib/ai/gemini";

export const dynamic = "force-dynamic";

async function env() {
  const t = await twilioFor();
  return {
    twilioConfigured: Boolean(t), aiConfigured, geminiConfigured, geminiModel: geminiConfigured ? GEMINI_MODEL : null,
    whatsappFrom: t?.creds.from ?? "", publicBaseUrl: publicBaseUrl(), demo: !t,
  };
}

export async function GET() {
  return NextResponse.json({ settings: await getSettings(), env: await env() });
}

export async function PUT(req: Request) {
  const me = await currentUser();
  if (!me || (me.role !== "owner" && me.role !== "admin")) return NextResponse.json({ error: "Only owners and admins can change settings." }, { status: 403 });
  const patch = (await req.json()) as Partial<Settings>;
  return NextResponse.json({ settings: await updateSettings(patch), env: await env() });
}
