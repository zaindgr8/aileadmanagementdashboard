import { NextResponse } from "next/server";
import { analyzeLead } from "@/lib/whatsapp/leads";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Re-score a chat as a lead right now.
export async function POST(_: Request, { params }: Ctx) {
  try {
    const lead = await analyzeLead(decodeURIComponent((await params).id));
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(lead);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
