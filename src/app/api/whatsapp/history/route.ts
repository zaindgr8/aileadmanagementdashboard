import { NextResponse } from "next/server";
import { listConversations, searchMessages } from "@/lib/whatsapp/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const results = await searchMessages({
    text: p.get("q") || undefined,
    author: p.get("author") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") ? `${p.get("to")}T23:59:59.999Z` : undefined,
    conversationId: p.get("conversation") || undefined,
  });
  const names = Object.fromEntries((await listConversations()).map((c) => [c.id, c.name || c.profileName || c.phone]));
  const rows = results.map((m) => ({ ...m, contact: names[m.conversationId] ?? m.conversationId.replace("whatsapp:", "") }));

  if (p.get("format") === "csv") {
    const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const csv = ["date,contact,phone,direction,author,status,message"]
      .concat(rows.map((r) => [r.createdAt, r.contact, r.conversationId.replace("whatsapp:", ""), r.direction, r.author, r.status, r.body].map(esc).join(",")))
      .join("\n");
    return new Response(csv, {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="whatsapp-history-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }
  const limit = Number(p.get("limit") || 500);
  return NextResponse.json({ total: rows.length, rows: rows.slice(0, limit) });
}
