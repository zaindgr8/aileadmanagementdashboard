import { NextResponse, after } from "next/server";
import { listConversations } from "@/lib/whatsapp/store";
import { seedDemoIfEmpty } from "@/lib/whatsapp/demo";
import { sessionOpen } from "@/lib/whatsapp/twilio";
import { instagramWindow } from "@/lib/instagram/send";
import { backfillLeads } from "@/lib/whatsapp/leads";
import { syncFromTwilio } from "@/lib/whatsapp/poller";
import { bindWorkspace } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export async function GET() {
  await seedDemoIfEmpty();
  // Pull new messages (e.g. n8n replies) from Twilio after responding; they show up on the next refresh.
  const run = await bindWorkspace();
  after(() => run(syncFromTwilio));
  after(() => run(backfillLeads).catch((err) => console.error("[leads]", err)));
  const conversations = await listConversations();
  return NextResponse.json(conversations.map((c) => ({ ...c, sessionOpen: sessionOpen(c.lastInboundAt), lateReply: c.channel === "instagram" && instagramWindow(c.lastInboundAt).humanAgent })));
}
