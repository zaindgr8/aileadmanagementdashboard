import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Instagram API with Instagram Login (Meta's official API for Instagram professional accounts).
// One Meta app (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET) serves every workspace: each workspace
// connects its own Instagram account with "Connect Instagram" and gets its own access token.
const VERSION = process.env.INSTAGRAM_GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.instagram.com/${VERSION}`;

export const SCOPES = ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments"];
export const WEBHOOK_FIELDS = ["messages", "messaging_postbacks", "comments"];

export function appCreds() {
  const appId = (process.env.INSTAGRAM_APP_ID || "").trim();
  const appSecret = (process.env.INSTAGRAM_APP_SECRET || "").trim();
  return appId && appSecret ? { appId, appSecret } : null;
}
export const instagramAppConfigured = () => Boolean(appCreds());

/** Token Meta sends back when verifying the webhook URL. Derived, so there's nothing extra to configure. */
export function webhookVerifyToken() {
  const base = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || process.env.SESSION_SECRET || "";
  return createHmac("sha256", base).update("instagram-webhook").digest("hex").slice(0, 32);
}

/** X-Hub-Signature-256 check: the body really came from Meta, signed with our app secret. */
export function verifySignature(raw: string, header: string | null) {
  const app = appCreds();
  if (!app || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", app.appSecret).update(raw).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export class InstagramError extends Error {
  constructor(message: string, readonly status = 502, readonly code?: number) { super(message); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new InstagramError(`Couldn't reach Instagram: ${err instanceof Error ? err.message : err}`);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_user_msg?: string }; error_message?: string };
  if (!res.ok || json.error) {
    const e = json.error;
    throw new InstagramError(e?.error_user_msg || e?.message || json.error_message || `Instagram HTTP ${res.status}`, res.status >= 500 ? 502 : 400, e?.code);
  }
  return json as T;
}

/** Where "Connect Instagram" sends the user. */
export function authorizeUrl(redirectUri: string, state: string) {
  const app = appCreds();
  if (!app) throw new InstagramError("The Instagram app isn't set up (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET).", 503);
  const q = new URLSearchParams({
    client_id: app.appId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(","), state,
    enable_fb_login: "0", force_reauth: "true",
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

/** Code from the login redirect → long-lived (≈60 day) token. */
export async function exchangeCode(code: string, redirectUri: string) {
  const app = appCreds();
  if (!app) throw new InstagramError("The Instagram app isn't set up.", 503);
  const body = new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code });
  const short = await call<{ access_token?: string; data?: { access_token: string }[] }>("https://api.instagram.com/oauth/access_token", { method: "POST", body });
  const shortToken = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new InstagramError("Instagram didn't return an access token.");
  const q = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: app.appSecret, access_token: shortToken });
  const long = await call<{ access_token: string; expires_in: number }>(`https://graph.instagram.com/access_token?${q}`);
  return { token: long.access_token, expiresAt: new Date(Date.now() + long.expires_in * 1000).toISOString() };
}

/** Long-lived tokens can be refreshed (for another ≈60 days) once they're at least a day old. */
export async function refreshToken(token: string) {
  const q = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token });
  const r = await call<{ access_token: string; expires_in: number }>(`https://graph.instagram.com/refresh_access_token?${q}`);
  return { token: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000).toISOString() };
}

export interface IgProfile { userId: string; username: string; name?: string; picture?: string; accountType?: string }

export async function getMe(token: string): Promise<IgProfile> {
  const q = new URLSearchParams({ fields: "user_id,username,name,profile_picture_url,account_type", access_token: token });
  const r = await call<{ user_id: string | number; username: string; name?: string; profile_picture_url?: string; account_type?: string }>(`${GRAPH}/me?${q}`);
  return { userId: String(r.user_id), username: r.username, name: r.name, picture: r.profile_picture_url, accountType: r.account_type };
}

/** Ask Meta to send this account's DMs and comments to our webhook. */
export async function subscribeWebhooks(token: string) {
  const q = new URLSearchParams({ subscribed_fields: WEBHOOK_FIELDS.join(","), access_token: token });
  await call(`${GRAPH}/me/subscribed_apps?${q}`, { method: "POST" });
}

export async function unsubscribeWebhooks(token: string) {
  const q = new URLSearchParams({ access_token: token });
  await call(`${GRAPH}/me/subscribed_apps?${q}`, { method: "DELETE" }).catch(() => {});
}

/** Name and username of someone who messaged the account (allowed once they've messaged us). */
export async function getUser(token: string, igsid: string): Promise<{ name?: string; username?: string; picture?: string }> {
  const q = new URLSearchParams({ fields: "name,username,profile_pic", access_token: token });
  const r = await call<{ name?: string; username?: string; profile_pic?: string }>(`${GRAPH}/${encodeURIComponent(igsid)}?${q}`);
  return { name: r.name, username: r.username, picture: r.profile_pic };
}

type Recipient = { id: string } | { comment_id: string };

/** Send a DM. `humanAgent` uses the HUMAN_AGENT tag (a person replying up to 7 days after the customer's last message). */
export async function sendText(token: string, to: Recipient, text: string, opts: { humanAgent?: boolean } = {}) {
  const body = {
    recipient: to,
    message: { text },
    ...(opts.humanAgent ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}),
  };
  const r = await call<{ recipient_id?: string; message_id?: string }>(`${GRAPH}/me/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { messageId: r.message_id ?? "", recipientId: r.recipient_id ?? "" };
}

/** Public reply under a comment. */
export async function replyToComment(token: string, commentId: string, text: string) {
  const q = new URLSearchParams({ message: text, access_token: token });
  return call<{ id: string }>(`${GRAPH}/${encodeURIComponent(commentId)}/replies?${q}`, { method: "POST" });
}
