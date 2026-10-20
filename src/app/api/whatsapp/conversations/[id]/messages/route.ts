import { NextResponse } from "next/server";
import { ensureConversation, getConversation, updateConversation } from "@/lib/whatsapp/store";
import { sendWhatsApp, sessionOpen, whatsappConnected } from "@/lib/whatsapp/twilio";
import { sendInstagram } from "@/lib/instagram/send";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Send a message from the dashboard as a human teammate (or a WhatsApp template).
export async function POST(req: Request, { params }: Ctx) {
  const id = decodeURIComponent((await params).id);
  const { body, contentSid, contentVariables, pauseAi = true } = (await req.json()) as {
    body?: string; contentSid?: string; contentVariables?: Record<string, string>; pauseAi?: boolean;
  };
  if (!body?.trim() && !contentSid) return NextResponse.json({ error: "Message is empty" }, { status: 400 });

  const conv = (await getConversation(id)) ?? (await ensureConversation(id));
  if (id.startsWith("instagram:")) {
    if (contentSid || !body?.trim()) return NextResponse.json({ error: "Instagram chats take a text message (no templates)." }, { status: 400 });
    try {
      const msg = await sendInstagram({ to: id, body: body.trim(), author: "agent" });
      await updateConversation(id, { unread: 0, needsHuman: false, ...(pauseAi ? { aiEnabled: false } : {}) });
      return NextResponse.json(msg);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 502 });
    }
  }
  if ((await whatsappConnected()) && !contentSid && !sessionOpen(conv.lastInboundAt)) {
    // WhatsApp rejects free-form messages outside the 24h customer-service window.
    return NextResponse.json({ error: "The 24-hour WhatsApp window is closed. Send an approved template instead." }, { status: 409 });
  }

  try {
    const msg = await sendWhatsApp({ to: id, body: body?.trim(), author: "agent", contentSid, contentVariables });
    // A human replying takes over the chat, so the AI doesn't talk over them.
    await updateConversation(id, { unread: 0, needsHuman: false, ...(pauseAi ? { aiEnabled: false } : {}) });
    return NextResponse.json(msg);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 502 });
  }
}
