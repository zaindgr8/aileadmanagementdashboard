import { NextResponse } from "next/server";
import { listWaLeads, WA_LEAD_COLUMNS } from "@/lib/whatsapp/waLeads";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const leads = await listWaLeads();
    if (new URL(req.url).searchParams.get("format") === "csv") {
      const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
      const csv = [WA_LEAD_COLUMNS.join(",")]
        .concat(leads.map((l) => WA_LEAD_COLUMNS.map((c) => esc(c === "handoff" ? (l.handoff ? "YES" : "") : l[c])).join(",")))
        .join("\n");
      return new Response(csv, {
        headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="whatsapp-leads-${new Date().toISOString().slice(0, 10)}.csv"` },
      });
    }
    return NextResponse.json(leads);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load leads" }, { status: 500 });
  }
}
