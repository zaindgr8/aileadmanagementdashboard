import "server-only";
import twilio from "twilio";
import type { Author, Message } from "./types";
import { getSettings, knownMessageStatuses, updateMessageStatus, upsertMessage } from "./store";
import { scheduleLeadAnalysis } from "./leads";

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
// Your WhatsApp sender, e.g. "whatsapp:+14155238886" (Sandbox) or your approved number.
export const WHATSAPP_FROM = normalize(process.env.TWILIO_WHATSAPP_FROM || "");
const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

export const twilioConfigured = Boolean(SID && TOKEN && (WHATSAPP_FROM || MESSAGING_SERVICE_SID));

let _client: twilio.Twilio | null = null;
export function client() {
  if (!SID || !TOKEN) throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).");
  return (_client ??= twilio(SID, TOKEN));
}

export function normalize(addr: string) {
  const a = addr.trim().replace(/\s+/g, "");
  if (!a) return "";
  return a.startsWith("whatsapp:") ? a : `whatsapp:${a}`;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
/** WhatsApp only allows free-form messages within 24h of the customer's last message. */
export function sessionOpen(lastInboundAt?: string) {
  return Boolean(lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS);
}

interface SendOpts {
  to: string;
  body?: string;
  author: Author;
  contentSid?: string;
  contentVariables?: Record<string, string>;
}

/** Send a WhatsApp message and record it. In demo mode (no Twilio creds) it's only stored locally. */
export async function sendWhatsApp({ to, body = "", author, contentSid, contentVariables }: SendOpts): Promise<Message> {
  const conversationId = normalize(to);
  const base = {
    conversationId,
    direction: "outbound" as const,
    author,
    body: body || (contentSid ? `[Template ${contentSid}]` : ""),
    media: [],
    createdAt: new Date().toISOString(),
  };

  if (!twilioConfigured) {
    return upsertMessage({ ...base, id: `demo_${crypto.randomUUID()}`, status: "demo" });
  }

  try {
    const msg = await client().messages.create({
      to: conversationId,
      ...(MESSAGING_SERVICE_SID ? { messagingServiceSid: MESSAGING_SERVICE_SID } : { from: WHATSAPP_FROM }),
      ...(contentSid
        ? { contentSid, contentVariables: contentVariables ? JSON.stringify(contentVariables) : undefined }
        : { body }),
      ...(PUBLIC_BASE_URL ? { statusCallback: `${PUBLIC_BASE_URL}/api/webhooks/twilio/status` } : {}),
    });
    return upsertMessage({ ...base, id: msg.sid, status: msg.status, body: msg.body || base.body });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await upsertMessage({ ...base, id: `failed_${crypto.randomUUID()}`, status: "failed", error });
    throw err;
  }
}

/** Import past WhatsApp messages from Twilio's message log into the dashboard. */
export async function importHistory(limit = 1000, since?: Date) {
  const automation = (await getSettings()).agentMode === "n8n";
  const c = client();
  const ours = new Set([WHATSAPP_FROM].filter(Boolean));
  const [sent, received] = await Promise.all([
    WHATSAPP_FROM ? c.messages.list({ from: WHATSAPP_FROM, limit, dateSentAfter: since }) : c.messages.list({ limit, dateSentAfter: since }),
    WHATSAPP_FROM ? c.messages.list({ to: WHATSAPP_FROM, limit, dateSentAfter: since }) : Promise.resolve([]),
  ]);

  const all = [...sent, ...received];
  const known = await knownMessageStatuses(all.map((m) => m.sid));
  let imported = 0;
  for (const m of all) {
    if (!m.from?.startsWith("whatsapp:") && !m.to?.startsWith("whatsapp:")) continue;
    const inbound = m.direction === "inbound" || (ours.size > 0 && ours.has(m.to));
    const customer = inbound ? m.from : m.to;
    // Keep messages we already know (they carry the right author, e.g. "ai"); just refresh status.
    if (known.has(m.sid)) {
      if (known.get(m.sid) !== m.status) await updateMessageStatus(m.sid, m.status);
      continue;
    }
    const media =
      Number(m.numMedia) > 0
        ? (await c.messages(m.sid).media.list()).map((x) => ({
            url: `https://api.twilio.com${x.uri.replace(/\.json$/, "")}`,
            contentType: x.contentType,
          }))
        : [];
    await upsertMessage({
      id: m.sid,
      conversationId: customer,
      direction: inbound ? "inbound" : "outbound",
      // Replies we didn't send from the dashboard came from your automation (n8n) or another tool.
      author: inbound ? "customer" : automation ? "ai" : "agent",
      body: m.body ?? "",
      media,
      status: m.status,
      createdAt: (m.dateSent ?? m.dateCreated).toISOString(),
      error: m.errorMessage ?? undefined,
    }, { countUnread: inbound && Boolean(since) });
    if (inbound && since) await scheduleLeadAnalysis(customer);
    imported++;
  }
  return imported;
}

export async function listTemplates() {
  const items = await client().content.v1.contentAndApprovals.list({ limit: 100 });
  return items.map((t) => ({
    sid: t.sid,
    name: t.friendlyName,
    language: t.language,
    variables: t.variables,
    status: (t.approvalRequests as { status?: string } | undefined)?.status ?? "unknown",
    types: Object.keys(t.types ?? {}),
  }));
}

/** Verify the request really came from Twilio (X-Twilio-Signature). */
export function verifyTwilio(req: Request, params: Record<string, string>) {
  if (process.env.TWILIO_SKIP_SIGNATURE === "true") return true;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get("x-twilio-signature");
  if (!token || !signature) return false;
  // Twilio signs the public URL it called, which differs from req.url behind ngrok / a proxy.
  const u = new URL(req.url);
  const url = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}${u.pathname}${u.search}` : req.url;
  return twilio.validateRequest(token, signature, url, params);
}

