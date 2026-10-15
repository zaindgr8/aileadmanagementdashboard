import { ensureConversation, upsertMessage } from "@/lib/whatsapp/store";
import { onInboundMessage } from "@/lib/whatsapp/agent";
import { verifyTwilio } from "@/lib/whatsapp/twilio";
import { scheduleLeadAnalysis } from "@/lib/whatsapp/leads";
import type { Media } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// Twilio → "A message comes in" webhook for your WhatsApp sender.
export async function POST(req: Request) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;
  if (!verifyTwilio(req, params)) return new Response("Invalid signature", { status: 403 });

  const from = params.From;
  if (!from?.startsWith("whatsapp:")) return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });

  const media: Media[] = [];
  for (let i = 0; i < Number(params.NumMedia || 0); i++) {
    if (params[`MediaUrl${i}`]) media.push({ url: params[`MediaUrl${i}`], contentType: params[`MediaContentType${i}`] || "" });
  }

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
  return reply ?? new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
