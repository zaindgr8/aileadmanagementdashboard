import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Client API keys (Twilio auth token, Retell key…) are stored encrypted with AES-256-GCM.
// The key comes from CREDENTIALS_KEY, or is derived from SESSION_SECRET when that isn't set.
// Changing whichever one is used makes saved keys unreadable, so they'd need entering again.
function key() {
  const base = process.env.CREDENTIALS_KEY || (process.env.SESSION_SECRET ? `${process.env.SESSION_SECRET}:credentials` : "");
  if (!base) throw new Error("Set CREDENTIALS_KEY (or SESSION_SECRET) to store client API keys.");
  return createHash("sha256").update(base).digest();
}

export function encrypt(value: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decrypt<T>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")) as T;
  } catch {
    console.error("[workspace] Saved API keys can't be decrypted (CREDENTIALS_KEY / SESSION_SECRET changed?).");
    return null;
  }
}
