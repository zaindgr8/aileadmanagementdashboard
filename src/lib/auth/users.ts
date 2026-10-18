import 'server-only';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { q, sb, supabaseConfigured } from '@/lib/supabase';
import { MODULES, type ModuleKey, type Role, type SessionUser } from './modules';

// Users live in Supabase (`app_users`, see supabase/platform.sql). Each belongs to one workspace
// (client account), has a role there and the list of modules they may open.
interface UserRow {
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  modules: string[];
  active: boolean;
  platform_admin: boolean;
  workspace_id: string;
  workspace: { id: string; name: string; status: string; modules: string[] } | null;
}

/** Same format scripts/hash-password.mjs produces. */
export function hashPassword(password: string) {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Checks a "scrypt$N$r$p$salt$hash" string (see scripts/hash-password.mjs). */
export function verifyPassword(password: string, stored: string) {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

const onlyModules = (list: string[]) => list.filter((m): m is ModuleKey => (MODULES as readonly string[]).includes(m));

/** What a user can open: their own modules, limited to what their workspace has. */
export function sessionUserFor(
  u: { username: string; display_name: string; role: Role; modules: string[]; platform_admin: boolean },
  ws: { id: string; name: string; modules: string[] },
): SessionUser {
  const wsModules = onlyModules(ws.modules);
  return {
    username: u.username,
    name: u.display_name || u.username,
    role: u.role,
    modules: onlyModules(u.modules).filter((m) => wsModules.includes(m)),
    workspace: ws.id,
    workspaceName: ws.name,
    platformAdmin: u.platform_admin,
  };
}

/** Usernames are unique across all workspaces (they're how people sign in). */
export async function usernameTaken(username: string) {
  return (await sb<{ username: string }[]>(`app_users?username=eq.${q(username)}&select=username`)).length > 0;
}

export async function emailTaken(email: string) {
  return (await sb<{ username: string }[]>(`app_users?email=eq.${q(email.toLowerCase())}&select=username`)).length > 0;
}

// Constant-time compare for the bootstrap fallback.
function same(a: string, b: string) {
  const k = 'bootstrap';
  return timingSafeEqual(createHmac('sha256', k).update(a).digest(), createHmac('sha256', k).update(b).digest());
}

const SELECT = 'username,display_name,password_hash,role,modules,active,platform_admin,workspace_id,workspace:workspaces(id,name,status,modules)';

export type AuthResult = { user: SessionUser } | { error: string; status: number };

/** Sign in with a username or email. Explains why when the account exists but can't sign in yet. */
export async function authenticate(login: string, password: string): Promise<AuthResult> {
  const name = login.trim().toLowerCase();
  const wrong = { error: 'Incorrect username or password', status: 401 };
  if (!name || !password) return wrong;

  if (supabaseConfigured) {
    try {
      const filter = name.includes('@') ? `email=eq.${q(name)}` : `username=eq.${q(name)}`;
      const rows = await sb<UserRow[]>(`app_users?${filter}&select=${SELECT}&limit=2`);
      const row = rows.length === 1 ? rows[0] : undefined;
      if (!row || !verifyPassword(password, row.password_hash)) return wrong;
      if (!row.active) return { error: 'Your account has been deactivated. Ask your workspace owner.', status: 403 };
      const ws = row.workspace;
      if (!ws) return { error: 'Your account is not linked to a workspace yet.', status: 403 };
      if (!row.platform_admin && ws.status === 'pending') return { error: `${ws.name} is waiting for approval. We'll email you as soon as it's live.`, status: 403 };
      if (!row.platform_admin && ws.status === 'suspended') return { error: `${ws.name} is suspended. Contact support to restore access.`, status: 403 };
      void sb(`app_users?username=eq.${q(row.username)}`, { method: 'PATCH', body: { last_login_at: new Date().toISOString() } }).catch(() => {});
      return { user: sessionUserFor(row, ws) };
    } catch (err) {
      // Table missing or Supabase down: only then fall through to the bootstrap login.
      console.error('[auth]', err instanceof Error ? err.message : err);
    }
  }

  const bu = (process.env.BOOTSTRAP_USERNAME || '').trim().toLowerCase();
  const bp = process.env.BOOTSTRAP_PASSWORD || '';
  if (bu && bp && same(name, bu) && same(password, bp)) {
    return { user: { username: bu, name: bu, role: 'owner', modules: [...MODULES], workspace: 'default', workspaceName: 'Default', platformAdmin: true } };
  }
  return wrong;
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
