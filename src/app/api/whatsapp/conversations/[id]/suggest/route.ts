import { NextResponse } from "next/server";
import { aiConfigured, generateReply } from "@/lib/whatsapp/agent";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Draft a reply with the AI without sending it — the teammate can edit and send.
export async function POST(_: Request, { params }: Ctx) {
  if (!aiConfigured) return NextResponse.json({ error: "Set GEMINI_API_KEY to use AI drafts." }, { status: 400 });
  try {
    const r = await generateReply(decodeURIComponent((await params).id));
    return NextResponse.json({ text: r.handoff ? "" : r.text, handoff: r.handoff, reason: r.reason });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
