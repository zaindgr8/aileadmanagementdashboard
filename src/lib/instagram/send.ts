import "server-only";
import type { Author, Message } from "../whatsapp/types";
import { getConversation, upsertMessage } from "../whatsapp/store";
import { instagramFor } from "./connect";
import { sendText } from "./api";

const HOUR = 3_600_000;

/** What Instagram allows right now for this chat. */
export function instagramWindow(lastInboundAt?: string) {
  const since = lastInboundAt ? Date.now() - new Date(lastInboundAt).getTime() : Infinity;
  // Free replies for 24h after their last message; then a person (not the AI) may reply for up to 7 days.
  return { open: since < 24 * HOUR, humanAgent: since >= 24 * HOUR && since < 7 * 24 * HOUR };
}

/** Send an Instagram DM to a chat ("instagram:<igsid>") and record it. */
export async function sendInstagram({ to, body, author }: { to: string; body: string; author: Author }): Promise<Message> {
  const conversationId = to;
  const igsid = to.replace(/^instagram:/, "");
  const base = { conversationId, direction: "outbound" as const, author, body, media: [], createdAt: new Date().toISOString() };
  const ig = await instagramFor();
  if (!ig) throw new Error("Instagram isn't connected for this workspace (Workspace settings → Connections).");

  const conv = await getConversation(conversationId);
  const win = instagramWindow(conv?.lastInboundAt);
  if (!win.open && !(win.humanAgent && author === "agent")) {
    throw new Error(win.humanAgent
      ? "It's been over 24 hours since their last message, so only a teammate (not the AI) can reply, until 7 days have passed."
      : "Instagram only allows replies within 7 days of the customer's last message.");
  }
  try {
    const r = await sendText(ig.token, { id: igsid }, body, { humanAgent: !win.open });
    return upsertMessage({ ...base, id: r.messageId || `ig_${crypto.randomUUID()}`, status: "sent" });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await upsertMessage({ ...base, id: `failed_${crypto.randomUUID()}`, status: "failed", error });
    throw err;
  }
}
