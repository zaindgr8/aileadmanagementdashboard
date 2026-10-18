import { NextResponse } from "next/server";
import { listWaLeads, WA_LEAD_COLUMNS, type WaLead } from "@/lib/whatsapp/waLeads";
import { listConversations } from "@/lib/whatsapp/store";
import { currentWorkspace } from "@/lib/tenant/workspaces";
import type { Conversation } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

const STAGE: Record<string, string> = { new: "new", qualified: "qualified", hot: "qualified", won: "member", lost: "opted_out" };

/** A lead row made from a chat, in the same shape as Freya's profiles. */
function fromChat(c: Conversation): WaLead {
  const l = c.lead;
  return {
    phone: c.phone, name: c.name, wa_name: c.profileName, query: l?.intent ?? "", association: l?.category ?? "",
    interest: l?.interest ?? "", business_owner: "unknown", stage: c.needsHuman ? "handoff" : STAGE[l?.stage ?? "new"] ?? "new",
    handoff: c.needsHuman, notes: l?.summary ?? "", last_seen: c.lastInboundAt ?? null, created_at: c.createdAt, updated_at: c.lastMessageAt,
  };
}

export async function GET(req: Request) {
  try {
    const [ws, convs] = await Promise.all([currentWorkspace(), listConversations()]);
    // The primary workspace has Freya's profiles (wa_leads, written by n8n); other workspaces build the list from their chats.
    const leads: WaLead[] = ws.isPrimary ? await listWaLeads() : convs.filter((c) => c.lastInboundAt).map(fromChat);
    // Attach the AI score from the matching chat ("whatsapp:+971…").
    const byId = new Map(convs.map((c) => [c.id, c]));
    const rows = leads.map((l) => {
      const lead = byId.get(`whatsapp:${l.phone}`)?.lead;
      return {
        ...l,
        ai: lead ? { score: lead.score, priority: lead.priority ?? null, intent: lead.intent, summary: lead.summary, nextStep: lead.nextStep, source: lead.source } : null,
      };
    });
    if (new URL(req.url).searchParams.get("format") === "csv") {
      const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
      const cols = [...WA_LEAD_COLUMNS, "score", "priority", "intent", "next_step"] as const;
      const csv = [cols.join(",")]
        .concat(rows.map((l) => [
          ...WA_LEAD_COLUMNS.map((c) => (c === "handoff" ? (l.handoff ? "YES" : "") : l[c])),
          l.ai?.score ?? "", l.ai?.priority ?? "", l.ai?.intent ?? "", l.ai?.nextStep ?? "",
        ].map(esc).join(",")))
        .join("\n");
      return new Response(csv, {
        headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="whatsapp-leads-${new Date().toISOString().slice(0, 10)}.csv"` },
      });
    }
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load leads" }, { status: 500 });
  }
}
