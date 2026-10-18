import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/current";
import { backfillLeads, backfillStatus } from "@/lib/whatsapp/leads";
import { geminiConfigured, GEMINI_MODEL } from "@/lib/ai/gemini";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ gemini: geminiConfigured, model: geminiConfigured ? GEMINI_MODEL : null, ...(await backfillStatus()) });
}

// Re-score every chat now (e.g. after changing what counts as qualified). Owners and admins only.
export async function POST() {
  const me = await currentUser();
  if (!me || (me.role !== "owner" && me.role !== "admin")) return NextResponse.json({ error: "Only owners and admins can re-score everything." }, { status: 403 });
  await backfillLeads(true);
  return NextResponse.json({ gemini: geminiConfigured, ...(await backfillStatus()) });
}
