import "server-only";
import twilio from "twilio";
import type { Author, Message } from "./types";
import { getSettings, knownMessageStatuses, updateMessageStatus, upsertMessage } from "./store";
import { scheduleLeadAnalysis } from "./leads";
import { currentWorkspace, publicBaseUrl, twilioCreds, type TwilioCreds, type Workspace } from "../tenant/workspaces";

// Each workspace has its own Twilio account and WhatsApp sender (Workspace settings → Connections).
// The primary workspace falls back to TWILIO_* in .env.local.
export { publicBaseUrl } from "../tenant/workspaces";

export interface TwilioCtx { client: twilio.Twilio; creds: TwilioCreds; workspace: string }

const g = globalThis as typeof globalThis & { __twilioClients?: Map<string, twilio.Twilio> };
const clients = (g.__twilioClients ??= new Map());

function clientFor(c: TwilioCreds) {
  const key = `${c.accountSid}:${c.authToken}`;
  let cl = clients.get(key);
  if (!cl) clients.set(key, (cl = twilio(c.accountSid, c.authToken)));
  return cl;
}

/** The current workspace's Twilio connection, or null when it isn't connected yet. */
export async function twilioFor(): Promise<TwilioCtx | null> {
  const ws = await currentWorkspace();
  const creds = twilioCreds(ws);
  return creds ? { client: clientFor(creds), creds, workspace: ws.id } : null;
}

export async function twilioConfigured() {
  return Boolean(await twilioFor());
}

async function requireTwilio(): Promise<TwilioCtx> {
  const t = await twilioFor();
  if (!t) throw new Error("WhatsApp isn't connected for this workspace yet (Workspace settings → Connections).");
  return t;
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

  const t = await twilioFor();
  if (!t) {
    return upsertMessage({ ...base, id: `demo_${crypto.randomUUID()}`, status: "demo" });
  }

  const callbackBase = publicBaseUrl();
  try {
    const msg = await t.client.messages.create({
      to: conversationId,
      ...(t.creds.messagingServiceSid ? { messagingServiceSid: t.creds.messagingServiceSid } : { from: t.creds.from }),
      ...(contentSid
        ? { contentSid, contentVariables: contentVariables ? JSON.stringify(contentVariables) : undefined }
        : { body }),
      ...(callbackBase ? { statusCallback: `${callbackBase}/api/webhooks/twilio/status?ws=${encodeURIComponent(t.workspace)}` } : {}),
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
  const { client: c, creds } = await requireTwilio();
  const from = creds.from;
  const ours = new Set([from].filter(Boolean));
  const [sent, received] = await Promise.all([
    from ? c.messages.list({ from, limit, dateSentAfter: since }) : c.messages.list({ limit, dateSentAfter: since }),
    from ? c.messages.list({ to: from, limit, dateSentAfter: since }) : Promise.resolve([]),
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

/** The text of a Content template (whichever type it is), for previews. */
function templateBody(types: unknown): string {
  for (const v of Object.values((types ?? {}) as Record<string, { body?: string }>)) if (v?.body) return v.body;
  return "";
}

export async function listTemplates() {
  const items = await (await requireTwilio()).client.content.v1.contentAndApprovals.list({ limit: 100 });
  return items.map((t) => ({
    sid: t.sid,
    name: t.friendlyName,
    language: t.language,
    variables: t.variables,
    status: (t.approvalRequests as { status?: string } | undefined)?.status ?? "unknown",
    types: Object.keys(t.types ?? {}),
    body: templateBody(t.types),
  }));
}

/** Verify the request really came from Twilio (X-Twilio-Signature), signed with this workspace's auth token. */
export function verifyTwilio(req: Request, params: Record<string, string>, ws: Workspace) {
  if (process.env.TWILIO_SKIP_SIGNATURE === "true") return true;
  const token = twilioCreds(ws)?.authToken;
  const signature = req.headers.get("x-twilio-signature");
  if (!token || !signature) return false;
  // Twilio signs the public URL it called, which differs from req.url behind ngrok / a proxy.
  const u = new URL(req.url);
  const base = publicBaseUrl();
  const url = base ? `${base}${u.pathname}${u.search}` : req.url;
  return twilio.validateRequest(token, signature, url, params);
}

/** Check a Twilio account SID + auth token and sender before saving them. */
export async function testTwilio(c: { accountSid: string; authToken: string; from?: string; messagingServiceSid?: string }) {
  const cl = twilio(c.accountSid, c.authToken);
  const account = await cl.api.v2010.accounts(c.accountSid).fetch();
  let sender = "";
  if (c.messagingServiceSid) sender = (await cl.messaging.v1.services(c.messagingServiceSid).fetch()).friendlyName;
  return { account: account.friendlyName, status: account.status, sender };
}

