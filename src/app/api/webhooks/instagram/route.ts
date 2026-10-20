import { NextResponse } from "next/server";
import { ensureConversation, getConversation, getSettings, knownMessageStatuses, updateConversation, upsertMessage } from "@/lib/whatsapp/store";
import { onInboundMessage } from "@/lib/whatsapp/agent";
import { scheduleLeadAnalysis } from "@/lib/whatsapp/leads";
import { addNote } from "@/lib/whatsapp/team";
import { inWorkspace } from "@/lib/tenant/context";
import { getUser, replyToComment, sendText, verifySignature, webhookVerifyToken } from "@/lib/instagram/api";
import { instagramFor, workspaceForInstagram } from "@/lib/instagram/connect";
import type { CommentRule, Media } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

// One webhook for every workspace's Instagram account (set once in the Meta app → Instagram → Webhooks).
// Meta sends DMs ("messaging") and comments ("changes"); entry.id is the Instagram account that received them.

// Meta checks the URL once when you save it.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === webhookVerifyToken()) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

interface Attachment { type: string; payload?: { url?: string } }
interface MessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: { mid: string; text?: string; is_echo?: boolean; is_deleted?: boolean; attachments?: Attachment[]; reply_to?: { story?: { url?: string } } };
  postback?: { mid?: string; title?: string; payload?: string };
}
interface CommentChange { field: string; value: { id: string; text?: string; from?: { id: string; username?: string }; media?: { id: string; media_product_type?: string } } }
interface Entry { id: string; time: number; messaging?: MessagingEvent[]; changes?: CommentChange[] }

const MIME: Record<string, string> = { image: "image/jpeg", video: "video/mp4", audio: "audio/mpeg" };
const toMedia = (a: Attachment[] = []): Media[] => a.filter((x) => x.payload?.url).map((x) => ({ url: x.payload!.url!, contentType: MIME[x.type] ?? `instagram/${x.type}` }));

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Invalid signature", { status: 403 });
  let body: { object?: string; entry?: Entry[] };
  try { body = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (body.object !== "instagram") return NextResponse.json({ ok: true });

  for (const entry of body.entry ?? []) {
    const ws = await workspaceForInstagram(String(entry.id));
    if (!ws) continue; // An account no workspace has connected (or a suspended one).
    await inWorkspace(ws.id, async () => {
      for (const ev of entry.messaging ?? []) await handleMessage(entry.id, ev).catch((e) => console.error("[instagram:dm]", e instanceof Error ? e.message : e));
      for (const ch of entry.changes ?? []) if (ch.field === "comments") await handleComment(entry.id, ch.value).catch((e) => console.error("[instagram:comment]", e instanceof Error ? e.message : e));
    });
  }
  // Always 200 quickly, or Meta retries and eventually disables the webhook.
  return NextResponse.json({ ok: true });
}

/** Name the chat after the person's Instagram name/username the first time we see them. */
async function ensureChat(igsid: string, fallbackUsername?: string) {
  const id = `instagram:${igsid}`;
  const existing = await getConversation(id);
  if (existing?.profileName) return id;
  let label = fallbackUsername ? `@${fallbackUsername}` : "";
  try {
    const ig = await instagramFor();
    if (ig) {
      const u = await getUser(ig.token, igsid);
      label = u.name && u.username ? `${u.name} (@${u.username})` : u.username ? `@${u.username}` : u.name || label;
    }
  } catch { /* Profile lookups can be refused (privacy settings); the chat still works. */ }
  await ensureConversation(id, label);
  return id;
}

async function handleMessage(accountId: string, ev: MessagingEvent) {
  const at = new Date(ev.timestamp || Date.now()).toISOString();

  // Something the business account sent: from our API (already saved) or typed in the Instagram app.
  if (ev.message?.is_echo) {
    if (!ev.message.mid || (await knownMessageStatuses([ev.message.mid])).size) return;
    const id = await ensureChat(ev.recipient.id);
    await upsertMessage({ id: ev.message.mid, conversationId: id, direction: "outbound", author: "agent", body: ev.message.text ?? "", media: toMedia(ev.message.attachments), status: "sent", createdAt: at });
    return;
  }
  if (ev.sender.id === String(accountId)) return;

  const text = ev.message?.text ?? ev.postback?.title ?? "";
  const mid = ev.message?.mid ?? ev.postback?.mid ?? `ig_${ev.timestamp}_${ev.sender.id}`;
  if (ev.message?.is_deleted) return;
  if (!ev.message && !ev.postback) return; // reads, reactions, typing…

  const id = await ensureChat(ev.sender.id);
  const media = toMedia(ev.message?.attachments);
  const storyReply = ev.message?.reply_to?.story;
  const shown = storyReply ? `↩ Replied to your story${text ? `: ${text}` : ""}` : text;
  const fresh = !(await knownMessageStatuses([mid])).size;
  await upsertMessage({ id: mid, conversationId: id, direction: "inbound", author: "customer", body: shown, media: storyReply?.url ? [...media, { url: storyReply.url, contentType: "instagram/story" }] : media, status: "received", createdAt: at }, { countUnread: true });
  if (!fresh) return; // Meta retried a webhook we already handled.

  await scheduleLeadAnalysis(id);
  await onInboundMessage(id, text || (media.length ? "[sent an attachment]" : ""), "");
}

const matches = (rule: CommentRule, text: string) => {
  if (!rule.enabled || !rule.dm.trim()) return false;
  const words = rule.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (!words.length) return true;
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}#@]+/gu, " ")} `;
  return words.some((w) => t.includes(` ${w} `) || text.toLowerCase().includes(w));
};

async function handleComment(accountId: string, c: CommentChange["value"]) {
  if (!c.from?.id || c.from.id === String(accountId)) return; // our own replies
  const rule = (await getSettings()).instagramRules.find((r) => matches(r, c.text ?? ""));
  if (!rule) return;
  const ig = await instagramFor();
  if (!ig) return;

  const id = await ensureChat(c.from.id, c.from.username);
  // Instagram allows one private reply per comment; it opens the DM thread with them.
  const sent = await sendText(ig.token, { comment_id: c.id }, rule.dm);
  await upsertMessage({ id: sent.messageId || `igc_${c.id}`, conversationId: id, direction: "outbound", author: "ai", body: rule.dm, media: [], status: "sent", createdAt: new Date().toISOString() });
  if (rule.publicReply?.trim()) await replyToComment(ig.token, c.id, rule.publicReply.trim()).catch((e) => console.error("[instagram:reply]", e instanceof Error ? e.message : e));
  await addNote({
    conversationId: id, author: "system", authorName: "System", kind: "event",
    body: `Commented “${(c.text ?? "").slice(0, 80)}” on a ${c.media?.media_product_type === "REELS" ? "reel" : "post"}: comment-to-DM rule sent the first message`,
  });
  const tags = (await getConversation(id))?.tags ?? [];
  if (!tags.includes("instagram-comment")) await updateConversation(id, { tags: [...tags, "instagram-comment"] });
}
