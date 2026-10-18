import { updateMessageStatus } from "@/lib/whatsapp/store";
import { verifyTwilio } from "@/lib/whatsapp/twilio";
import { inWorkspace } from "@/lib/tenant/context";
import { workspaceForTwilio } from "@/lib/tenant/workspaces";

export const dynamic = "force-dynamic";

// Twilio delivery status callback (queued → sent → delivered → read / failed).
export async function POST(req: Request) {
  const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  const ws = await workspaceForTwilio({ ws: new URL(req.url).searchParams.get("ws"), to: params.From, accountSid: params.AccountSid });
  if (!ws) return new Response("Unknown workspace", { status: 404 });
  if (!verifyTwilio(req, params, ws)) return new Response("Invalid signature", { status: 403 });
  if (params.MessageSid && params.MessageStatus) {
    await inWorkspace(ws.id, () => updateMessageStatus(params.MessageSid, params.MessageStatus, params.ErrorCode ? `Error ${params.ErrorCode}` : undefined));
  }
  return new Response(null, { status: 204 });
}
