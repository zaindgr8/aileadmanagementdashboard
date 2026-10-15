import { updateMessageStatus } from "@/lib/whatsapp/store";
import { verifyTwilio } from "@/lib/whatsapp/twilio";

export const dynamic = "force-dynamic";

// Twilio delivery status callback (queued → sent → delivered → read / failed).
export async function POST(req: Request) {
  const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  if (!verifyTwilio(req, params)) return new Response("Invalid signature", { status: 403 });
  if (params.MessageSid && params.MessageStatus) {
    await updateMessageStatus(params.MessageSid, params.MessageStatus, params.ErrorCode ? `Error ${params.ErrorCode}` : undefined);
  }
  return new Response(null, { status: 204 });
}
