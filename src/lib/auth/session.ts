import { createHmac, timingSafeEqual } from 'node:crypto';
import { MODULES, type ModuleKey, type Role, type SessionUser } from './modules';

// Signed, stateless session cookie shared by the proxy and every route handler.
// Token: base64url(JSON payload) + "." + HMAC-SHA256 signature.
export const SESSION_COOKIE = 'alm_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Payload { u: string; n: string; r: Role; m: ModuleKey[]; exp: number }

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}

const sign = (v: string) => createHmac('sha256', secret()).update(v).digest('base64url');

export function createSession(user: SessionUser) {
  const payload: Payload = { u: user.username, n: user.name, r: user.role, m: user.modules, exp: Date.now() + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** The user in a session token, or null if it's missing, forged or expired. */
export function readSession(token?: string | null): SessionUser | null {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const expect = Buffer.from(sign(body));
  if (sig.length !== expect.length || !timingSafeEqual(sig, expect)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload;
    if (!(p.exp > Date.now())) return null;
    return { username: p.u, name: p.n, role: p.r, modules: p.m.filter((m) => (MODULES as readonly string[]).includes(m)) };
  } catch {
    return null;
  }
}

export const cookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure,
  path: '/',
  maxAge: SESSION_TTL_MS / 1000,
});
