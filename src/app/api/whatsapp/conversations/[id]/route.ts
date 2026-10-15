import { NextResponse } from "next/server";
import { getConversation, getMessages, updateConversation } from "@/lib/whatsapp/store";
import type { Lead } from "@/lib/whatsapp/types";
import { sessionOpen } from "@/lib/whatsapp/twilio";
import type { Conversation } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const id = decodeURIComponent((await params).id);
  const [c, messages] = await Promise.all([getConversation(id), getMessages(id)]);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ conversation: { ...c, sessionOpen: sessionOpen(c.lastInboundAt) }, messages });
}

const EDITABLE = ["name", "aiEnabled", "needsHuman", "status", "tags", "notes", "unread"] as const;

export async function PATCH(req: Request, { params }: Ctx) {
  const id = decodeURIComponent((await params).id);
  const body = (await req.json()) as Partial<Conversation>;
  const patch: Partial<Conversation> = {};
  for (const k of EDITABLE) if (k in body) (patch as Record<string, unknown>)[k] = body[k];
  // Turning AI back on clears the "needs human" flag.
  if (patch.aiEnabled === true) Object.assign(patch, { needsHuman: false, handoffReason: undefined });
  if (body.lead) {
    const prev = (await getConversation(id))?.lead;
    const base: Lead = prev ?? { stage: "new", score: 0, intent: "", summary: "", interest: "", budget: "", email: "", company: "", nextStep: "", source: "rules", analyzedAt: new Date().toISOString() };
    // A stage chosen by a teammate sticks: the AI keeps scoring but won't move it.
    patch.lead = { ...base, ...body.lead, ...(body.lead.stage ? { stageLocked: true } : {}) };
  }
  const c = await updateConversation(id, patch);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(c);
}
