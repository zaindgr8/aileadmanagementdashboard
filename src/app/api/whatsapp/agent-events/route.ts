import { NextResponse } from "next/server";
import { listAgentEvents } from "@/lib/whatsapp/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listAgentEvents(200));
}
