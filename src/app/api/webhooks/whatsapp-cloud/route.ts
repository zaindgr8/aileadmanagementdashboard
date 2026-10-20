import { NextResponse } from "next/server";
import { ensureConversation, knownMessageStatuses, updateMessageStatus, upsertMessage } from "@/lib/whatsapp/store";
import { onInboundMessage } from "@/lib/whatsapp/agent";
import { scheduleLeadAnalysis } from "@/lib/whatsapp/leads";
import { inWorkspace } from "@/lib/tenant/context";
import { verifySignature, webhookVerifyToken } from "@/lib/whatsapp-cloud/api";
import { workspaceForPhoneNumberId } from "@/lib/whatsapp-cloud/connect";
import type { Media } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

// One webhook for every workspace connected with Embedded Signup (Meta app → WhatsApp → Configuration).
// Each change carries metadata.phone_number_id, which tells us the workspace.

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === webhookVerifyToken()) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

interface MediaPart { id: string; mime_type?: string; caption?: string; filename?: string }
interface InMessage {
  from: string; id: string; timestamp: string; type: string;
  text?: { body: string };
  image?: MediaPart; video?: MediaPart; audio?: MediaPart; document?: MediaPart; sticker?: MediaPart;
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string; description?: string } };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  reaction?: { emoji?: string };
  contacts?: { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[];
}
interface Status { id: string; status: string; errors?: { code: number; title?: string; message?: string }[] }
interface Value {
  metadata?: { phone_number_id: string; display_phone_number?: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: InMessage[];
  statuses?: Status[];
}

/** Text to show and media to attach, for any message type. */
function readMessage(m: InMessage): { text: string; media: Media[] } {
  const part = m.image ?? m.video ?? m.audio ?? m.document ?? m.sticker;
  const media: Media[] = part ? [{ url: `meta-media:${part.id}`, contentType: part.mime_type || `${m.type}/*` }] : [];
  const text =
    m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ??
    part?.caption ?? (m.document ? `📄 ${m.document.filename ?? "Document"}` : "");
  if (m.location) return { text: `📍 ${m.location.name ?? "Location"} https://maps.google.com/?q=${m.location.latitude},${m.location.longitude}`, media };
  if (m.reaction) return { text: `Reacted ${m.reaction.emoji ?? ""}`.trim(), media };
  if (m.contacts?.length) return { text: `👤 ${m.contacts.map((c) => `${c.name?.formatted_name ?? ""} ${c.phones?.[0]?.phone ?? ""}`.trim()).join(", ")}`, media };
  return { text, media };
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Invalid signature", { status: 403 });
  let body: { object?: string; entry?: { changes?: { field: string; value: Value }[] }[] };
  try { body = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (body.object !== "whatsapp_business_account") return NextResponse.json({ ok: true });

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const v = change.value;
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const ws = await workspaceForPhoneNumberId(phoneNumberId);
      if (!ws) continue;
      await inWorkspace(ws.id, async () => {
        for (const s of v.statuses ?? []) {
          const err = s.errors?.[0];
          await updateMessageStatus(s.id, s.status, err ? `Error ${err.code}: ${err.message ?? err.title ?? ""}`.trim() : undefined).catch(() => {});
        }
        for (const m of v.messages ?? []) {
          try {
            const id = `whatsapp:+${m.from}`;
            const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? "";
            const { text, media } = readMessage(m);
            const fresh = !(await knownMessageStatuses([m.id])).size;
            await ensureConversation(id, name);
            await upsertMessage({
              id: m.id, conversationId: id, direction: "inbound", author: "customer", body: text, media, status: "received",
              createdAt: new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString(),
            }, { countUnread: true });
            if (!fresh || m.reaction) continue; // a retried webhook, or just a reaction
            await scheduleLeadAnalysis(id);
            await onInboundMessage(id, text || (media.length ? "[sent an attachment]" : ""), "", { canForward: false });
          } catch (err) {
            console.error("[whatsapp-cloud]", err instanceof Error ? err.message : err);
          }
        }
      });
    }
  }
  // Answer quickly with 200, or Meta retries and eventually turns the webhook off.
  return NextResponse.json({ ok: true });
}
