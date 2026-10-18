import { ensureConversation, upsertMessage } from "@/lib/whatsapp/store";
import { onInboundMessage } from "@/lib/whatsapp/agent";
import { verifyTwilio } from "@/lib/whatsapp/twilio";
import { scheduleLeadAnalysis } from "@/lib/whatsapp/leads";
import { inWorkspace } from "@/lib/tenant/context";
import { workspaceForTwilio } from "@/lib/tenant/workspaces";
import type { Media } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const empty = () => new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });

// Twilio → "A message comes in" webhook for a workspace's WhatsApp sender.
// The URL can carry ?ws=<workspace>; otherwise the workspace is found from the number messaged.
export async function POST(req: Request) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;
  const ws = await workspaceForTwilio({ ws: new URL(req.url).searchParams.get("ws"), to: params.To, accountSid: params.AccountSid });
  if (!ws) return new Response("Unknown WhatsApp number", { status: 404 });
  if (!verifyTwilio(req, params, ws)) return new Response("Invalid signature", { status: 403 });
  if (ws.status !== "active") return empty();

  const from = params.From;
  if (!from?.startsWith("whatsapp:")) return empty();

  const media: Media[] = [];
  for (let i = 0; i < Number(params.NumMedia || 0); i++) {
    if (params[`MediaUrl${i}`]) media.push({ url: params[`MediaUrl${i}`], contentType: params[`MediaContentType${i}`] || "" });
  }

  return inWorkspace(ws.id, async () => {
    await ensureConversation(from, params.ProfileName || "");
    await upsertMessage(
      {
        id: params.MessageSid || params.SmsMessageSid || crypto.randomUUID(),
        conversationId: from,
        direction: "inbound",
        author: "customer",
        body: params.Body || "",
        media,
        status: "received",
        createdAt: new Date().toISOString(),
      },
      { countUnread: true },
    );

    await scheduleLeadAnalysis(from);
    const reply = await onInboundMessage(from, params.Body || "", raw);
    return reply ?? empty();
  });
}
