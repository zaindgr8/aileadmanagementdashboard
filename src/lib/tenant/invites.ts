import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { q, sb } from "../supabase";
import { MODULES, type ModuleKey, type Role } from "../auth/modules";
import { emailTaken, hashPassword, sessionUserFor, usernameTaken } from "../auth/users";
import { getWorkspace, type Workspace } from "./workspaces";
import type { Invite } from "./types";

// Invite links: "https://app/invite/<token>". Only a hash of the token is stored, so a database
// leak can't be turned into working links. Each link works once and expires after 7 days.
const DAYS = 7;
const hash = (token: string) => createHash("sha256").update(token).digest("base64url");

interface Row {
  id: string; workspace_id: string; email: string; name: string; role: Role; modules: string[];
  created_by: string | null; created_at: string; expires_at: string; used_at: string | null; used_by: string | null;
}
const toInvite = (r: Row): Invite => ({
  id: r.id, workspaceId: r.workspace_id, email: r.email, name: r.name, role: r.role,
  modules: r.modules.filter((m): m is ModuleKey => (MODULES as readonly string[]).includes(m)),
  createdBy: r.created_by ?? "", createdAt: new Date(r.created_at).toISOString(), expiresAt: new Date(r.expires_at).toISOString(),
  usedAt: r.used_at ? new Date(r.used_at).toISOString() : undefined, usedBy: r.used_by ?? undefined,
});

export const USERNAME = /^[a-z0-9._-]{3,32}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createInvite(i: { workspaceId: string; email?: string; name?: string; role: Role; modules: ModuleKey[]; createdBy: string }) {
  const token = randomBytes(24).toString("base64url");
  const rows = await sb<Row[]>("invites", {
    method: "POST",
    prefer: "return=representation",
    body: {
      token_hash: hash(token), workspace_id: i.workspaceId, email: (i.email ?? "").trim().toLowerCase(), name: (i.name ?? "").trim(),
      role: i.role, modules: i.modules, created_by: i.createdBy, expires_at: new Date(Date.now() + DAYS * 86_400_000).toISOString(),
    },
  });
  return { invite: toInvite(rows[0]), token };
}

/** Invites that haven't been used and haven't expired. */
export async function listInvites(workspaceId: string): Promise<Invite[]> {
  const rows = await sb<Row[]>(`invites?workspace_id=eq.${q(workspaceId)}&used_at=is.null&expires_at=gt.${q(new Date().toISOString())}&select=*&order=created_at.desc`);
  return rows.map(toInvite);
}

export async function revokeInvite(workspaceId: string, id: string) {
  await sb(`invites?workspace_id=eq.${q(workspaceId)}&id=eq.${q(id)}`, { method: "DELETE" });
}

/** The invite behind a link, if it can still be used. */
export async function openInvite(token: string): Promise<{ invite: Invite; workspace: Workspace } | { error: string }> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { error: "This invite link isn't valid." };
  const rows = await sb<Row[]>(`invites?token_hash=eq.${q(hash(token))}&select=*`);
  const r = rows[0];
  if (!r) return { error: "This invite link isn't valid. Ask for a new one." };
  if (r.used_at) return { error: "This invite has already been used. Sign in instead." };
  if (new Date(r.expires_at).getTime() < Date.now()) return { error: "This invite has expired. Ask for a new one." };
  const workspace = await getWorkspace(r.workspace_id);
  if (!workspace || workspace.status === "suspended") return { error: "This workspace isn't available." };
  return { invite: toInvite(r), workspace };
}

/** Create the account the invite is for and mark the invite used. */
export async function acceptInvite(token: string, a: { username: string; name: string; password: string; email?: string }) {
  const opened = await openInvite(token);
  if ("error" in opened) return opened;
  const { invite, workspace } = opened;
  const username = a.username.trim().toLowerCase();
  const email = (invite.email || a.email || "").trim().toLowerCase();
  if (!USERNAME.test(username)) return { error: "Username: 3–32 characters, letters, numbers, dot, dash or underscore." };
  if (a.password.length < 8) return { error: "Password must be at least 8 characters." };
  if (email && !EMAIL.test(email)) return { error: "That email doesn't look right." };
  if (await usernameTaken(username)) return { error: "That username is taken. Try another." };
  if (email && (await emailTaken(email))) return { error: "An account with that email already exists. Sign in instead." };

  // Claim the invite first so the same link can't create two accounts.
  const claimed = await sb<Row[]>(`invites?id=eq.${q(invite.id)}&used_at=is.null`, {
    method: "PATCH", prefer: "return=representation", body: { used_at: new Date().toISOString(), used_by: username },
  });
  if (!claimed.length) return { error: "This invite has already been used. Sign in instead." };

  const user = { username, display_name: a.name.trim() || username, role: invite.role, modules: invite.modules, platform_admin: false };
  try {
    await sb("app_users", {
      method: "POST",
      body: { ...user, workspace_id: workspace.id, password_hash: hashPassword(a.password), active: true, ...(email ? { email } : {}) },
    });
  } catch (err) {
    await sb(`invites?id=eq.${q(invite.id)}`, { method: "PATCH", body: { used_at: null, used_by: null } }).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return { error: /duplicate|unique/i.test(msg) ? "That username or email is already taken." : "Couldn't create your account. Try again." };
  }
  return { user: sessionUserFor(user, workspace) };
}

export const inviteUrl = (base: string, token: string) => `${base.replace(/\/$/, "")}/invite/${token}`;
