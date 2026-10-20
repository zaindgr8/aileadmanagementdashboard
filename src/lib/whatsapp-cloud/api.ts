import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// WhatsApp Cloud API (Meta) with Embedded Signup. One Meta app ("Sixty by DevMate", META_APP_ID /
// META_APP_SECRET) serves every workspace: each client clicks "Connect WhatsApp", goes through
// Meta's pop-up, and we receive their WhatsApp Business Account (WABA) and phone number.
const VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;

export function metaApp() {
  const appId = (process.env.META_APP_ID || "").trim();
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  const configId = (process.env.META_ES_CONFIG_ID || "").trim();
  return appId && appSecret ? { appId, appSecret, configId } : null;
}
/** What the browser needs to open the Embedded Signup pop-up (nothing secret). */
export function embeddedSignupConfig() {
  const app = metaApp();
  return app?.configId ? { appId: app.appId, configId: app.configId, version: VERSION } : null;
}

export function webhookVerifyToken() {
  const base = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.SESSION_SECRET || "";
  return createHmac("sha256", base).update("whatsapp-cloud-webhook").digest("hex").slice(0, 32);
}

export function verifySignature(raw: string, header: string | null) {
  const app = metaApp();
  if (!app || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", app.appSecret).update(raw).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export class CloudError extends Error {
  constructor(message: string, readonly status = 502, readonly code?: number) { super(message); }
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
      ...rest,
      headers: { ...(rest.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...rest.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new CloudError(`Couldn't reach WhatsApp: ${err instanceof Error ? err.message : err}`);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_user_msg?: string; error_data?: { details?: string } } };
  if (!res.ok || json.error) {
    const e = json.error;
    throw new CloudError(e?.error_user_msg || e?.error_data?.details || e?.message || `WhatsApp HTTP ${res.status}`, res.status >= 500 ? 502 : 400, e?.code);
  }
  return json as T;
}

/** Embedded Signup returns a code; swap it for the client's business token. */
export async function exchangeCode(code: string) {
  const app = metaApp();
  if (!app) throw new CloudError("The Meta app isn't set up (META_APP_ID / META_APP_SECRET).", 503);
  const q = new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, code });
  const r = await call<{ access_token: string; expires_in?: number }>(`${GRAPH}/oauth/access_token?${q}`);
  return { token: r.access_token, expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : undefined };
}

export interface PhoneInfo { id: string; displayPhone: string; verifiedName: string; quality?: string; status?: string }

export async function getPhone(token: string, phoneNumberId: string): Promise<PhoneInfo> {
  const r = await call<{ id: string; display_phone_number: string; verified_name: string; quality_rating?: string; status?: string }>(
    `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,status`, { token });
  return { id: r.id, displayPhone: r.display_phone_number, verifiedName: r.verified_name, quality: r.quality_rating, status: r.status };
}

export async function getWaba(token: string, wabaId: string) {
  return call<{ id: string; name?: string; currency?: string }>(`/${encodeURIComponent(wabaId)}?fields=name,currency`, { token });
}

/** If the session event didn't include them, find the client's WABA and number from the token. */
export async function discoverAssets(token: string): Promise<{ wabaId: string; phoneNumberId: string } | null> {
  const app = metaApp();
  if (!app) return null;
  const q = new URLSearchParams({ input_token: token, access_token: `${app.appId}|${app.appSecret}` });
  const dbg = await call<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(`${GRAPH}/debug_token?${q}`);
  const wabaId = dbg.data?.granular_scopes?.find((s) => s.scope === "whatsapp_business_management")?.target_ids?.[0];
  if (!wabaId) return null;
  const phones = await call<{ data: { id: string }[] }>(`/${encodeURIComponent(wabaId)}/phone_numbers?fields=id`, { token });
  return phones.data[0] ? { wabaId, phoneNumberId: phones.data[0].id } : null;
}

/** Send this WABA's messages and statuses to our webhook. */
export async function subscribeApp(token: string, wabaId: string) {
  await call(`/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: "POST", token });
}
export async function unsubscribeApp(token: string, wabaId: string) {
  await call(`/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: "DELETE", token }).catch(() => {});
}

/** Register the number for the Cloud API (needed once). Already-registered numbers are fine. */
export async function registerPhone(token: string, phoneNumberId: string, pin: string) {
  try {
    await call(`/${encodeURIComponent(phoneNumberId)}/register`, { method: "POST", token, body: JSON.stringify({ messaging_product: "whatsapp", pin }) });
  } catch (err) {
    // Re-registering a number that's already on the Cloud API is harmless; anything else is reported.
    if (!(err instanceof CloudError) || !/already|registered/i.test(err.message)) throw err;
  }
}

const digits = (to: string) => to.replace(/^whatsapp:/, "").replace(/[^\d]/g, "");

export async function sendText(token: string, phoneNumberId: string, to: string, text: string) {
  const r = await call<{ messages?: { id: string }[] }>(`/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST", token,
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: digits(to), type: "text", text: { body: text, preview_url: true } }),
  });
  return r.messages?.[0]?.id ?? "";
}

/** Send an approved template. Variables {{1}}, {{2}}… go into the body in order. */
export async function sendTemplate(token: string, phoneNumberId: string, to: string, name: string, language: string, vars: Record<string, string> = {}) {
  const params = Object.keys(vars).sort((a, b) => Number(a) - Number(b)).map((k) => ({ type: "text", text: vars[k] }));
  const r = await call<{ messages?: { id: string }[] }>(`/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST", token,
    body: JSON.stringify({
      messaging_product: "whatsapp", to: digits(to), type: "template",
      template: { name, language: { code: language }, ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}) },
    }),
  });
  return r.messages?.[0]?.id ?? "";
}

interface TemplateRow { name: string; language: string; status: string; category: string; components?: { type: string; text?: string }[] }

export async function listTemplates(token: string, wabaId: string) {
  const r = await call<{ data: TemplateRow[] }>(`/${encodeURIComponent(wabaId)}/message_templates?fields=name,language,status,category,components&limit=200`, { token });
  return r.data.map((t) => {
    const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
    const vars = Object.fromEntries([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => [m[1], ""]));
    return { sid: `meta:${t.name}|${t.language}`, name: t.name, language: t.language, status: t.status.toLowerCase(), variables: vars, body, types: [t.category.toLowerCase()] };
  });
}

/** Media sent by a customer: Meta gives an id; this fetches the file with the workspace token. */
export async function downloadMedia(token: string, mediaId: string) {
  const meta = await call<{ url: string; mime_type: string }>(`/${encodeURIComponent(mediaId)}`, { token });
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new CloudError(`Media unavailable (${res.status})`, res.status);
  return { body: res.body, contentType: meta.mime_type || res.headers.get("content-type") || "application/octet-stream" };
}
