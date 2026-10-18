import { NextResponse } from "next/server";
import { getConversation, getMessages, getSettings, updateConversation } from "@/lib/whatsapp/store";
import { addNote, listAgents } from "@/lib/whatsapp/team";
import { currentUser } from "@/lib/auth/current";
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

const EDITABLE = ["name", "aiEnabled", "needsHuman", "status", "tags", "notes", "unread", "aiInstructions", "aiInstructionsMode"] as const;

export async function PATCH(req: Request, { params }: Ctx) {
  const id = decodeURIComponent((await params).id);
  const body = (await req.json()) as Partial<Conversation>;
  const patch: Partial<Conversation> = {};
  for (const k of EDITABLE) if (k in body) (patch as Record<string, unknown>)[k] = body[k];
  // Turning AI back on clears the "needs human" flag.
  if (patch.aiEnabled === true) Object.assign(patch, { needsHuman: false, handoffReason: undefined });
  if ("aiInstructions" in patch) {
    const text = String(patch.aiInstructions ?? "").trim().slice(0, 2000);
    patch.aiInstructions = text || undefined;
  }
  if ("aiInstructionsMode" in patch) patch.aiInstructionsMode = patch.aiInstructionsMode === "replace" ? "replace" : "add";
  const before = await getConversation(id);
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const me = await currentUser();
  const events: string[] = [];
  const textChanged = "aiInstructions" in patch && (patch.aiInstructions ?? "") !== (before.aiInstructions ?? "");
  const modeChanged = "aiInstructionsMode" in patch && patch.aiInstructionsMode !== (before.aiInstructionsMode ?? "add");
  if (textChanged || modeChanged) {
    const by = me ? ` by ${me.name}` : "";
    const text = "aiInstructions" in patch ? patch.aiInstructions : before.aiInstructions;
    const mode = patch.aiInstructionsMode ?? before.aiInstructionsMode ?? "add";
    events.push(!text ? `Custom brief removed${by}` : mode === "replace" ? `Custom brief set: replaces the usual instructions${by}` : `Custom instructions added to the usual ones${by}`);
  }

  // Assigning: null/"" unassigns, otherwise it must be an active WhatsApp agent.
  if ("assignee" in body && (body.assignee || null) !== (before.assignee || null)) {
    if (body.assignee) {
      const agent = (await listAgents()).find((a) => a.username === body.assignee && a.active);
      if (!agent) return NextResponse.json({ error: "That teammate can't be assigned WhatsApp chats." }, { status: 400 });
      Object.assign(patch, { assignee: agent.username, assignedAt: new Date().toISOString() });
      events.push(agent.username === me?.username ? `${agent.name} took this chat` : `Assigned to ${agent.name}${me ? ` by ${me.name}` : ""}`);
    } else {
      Object.assign(patch, { assignee: undefined, assignedAt: undefined });
      events.push(`Unassigned${me ? ` by ${me.name}` : ""}`);
    }
  }
  // Optional rule: resolving a chat frees up the agent.
  if (patch.status === "resolved" && before.status !== "resolved" && before.assignee && !("assignee" in body) && (await getSettings()).assignment.unassignOnResolve) {
    Object.assign(patch, { assignee: undefined, assignedAt: undefined });
    events.push("Resolved and unassigned");
  }

  if (body.lead) {
    const prev = (await getConversation(id))?.lead;
    const base: Lead = prev ?? { stage: "new", score: 0, intent: "", summary: "", interest: "", budget: "", email: "", company: "", nextStep: "", source: "rules", analyzedAt: new Date().toISOString() };
    // A stage chosen by a teammate sticks: the AI keeps scoring but won't move it.
    patch.lead = { ...base, ...body.lead, ...(body.lead.stage ? { stageLocked: true } : {}) };
  }
  const c = await updateConversation(id, patch);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  for (const e of events) await addNote({ conversationId: id, author: "system", authorName: "System", kind: "event", body: e });
  return NextResponse.json(c);
}
