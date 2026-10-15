import 'server-only';
import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { q, sb, supabaseConfigured } from '@/lib/supabase';
import { MODULES, type ModuleKey, type Role, type SessionUser } from './modules';

// Users live in Supabase (`app_users`, see supabase/schema.sql). Each has a role and the list of
// modules they may open, so adding teammates later is just inserting rows.
interface UserRow {
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  modules: string[];
  active: boolean;
}

/** Checks a "scrypt$N$r$p$salt$hash" string (see scripts/hash-password.mjs). */
export function verifyPassword(password: string, stored: string) {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

const toUser = (r: UserRow): SessionUser => ({
  username: r.username,
  name: r.display_name || r.username,
  role: r.role,
  modules: r.modules.filter((m): m is ModuleKey => (MODULES as readonly string[]).includes(m)),
});

// Constant-time compare for the bootstrap fallback.
function same(a: string, b: string) {
  const k = 'bootstrap';
  return timingSafeEqual(createHmac('sha256', k).update(a).digest(), createHmac('sha256', k).update(b).digest());
}

/** The user for these credentials, or null. */
export async function authenticate(username: string, password: string): Promise<SessionUser | null> {
  const name = username.trim().toLowerCase();
  if (!name || !password) return null;

  if (supabaseConfigured) {
    try {
      const rows = await sb<UserRow[]>(`app_users?username=eq.${q(name)}&select=username,display_name,password_hash,role,modules,active`);
      const row = rows[0];
      if (!row) return null;
      if (!row.active || !verifyPassword(password, row.password_hash)) return null;
      void sb(`app_users?username=eq.${q(name)}`, { method: 'PATCH', body: { last_login_at: new Date().toISOString() } }).catch(() => {});
      return toUser(row);
    } catch (err) {
      // Table missing or Supabase down: only then fall through to the bootstrap login.
      console.error('[auth]', err instanceof Error ? err.message : err);
    }
  }

  const bu = (process.env.BOOTSTRAP_USERNAME || '').trim().toLowerCase();
  const bp = process.env.BOOTSTRAP_PASSWORD || '';
  if (bu && bp && same(name, bu) && same(password, bp)) {
    return { username: bu, name: bu, role: 'owner', modules: [...MODULES] };
  }
  return null;
}

// Simple per-IP brake on password guessing (per server instance).
const attempts = new Map<string, number[]>();
const WINDOW = 15 * 60_000;
export function tooManyAttempts(ip: string) {
  const now = Date.now();
  if (attempts.size > 5000) attempts.forEach((t, k) => { if (!t.some((x) => now - x < WINDOW)) attempts.delete(k); });
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW);
  attempts.set(ip, recent);
  return recent.length >= 10;
}
export function recordFailedAttempt(ip: string) {
  attempts.set(ip, [...(attempts.get(ip) ?? []), Date.now()]);
}
