import "server-only";
import { sb } from "../supabase";
import type { ModuleKey } from "../auth/modules";
import { emailTaken, hashPassword, usernameTaken } from "../auth/users";
import { EMAIL, USERNAME } from "./invites";
import { createWorkspace, listWorkspaces, publicInfo, retellCreds, twilioCreds } from "./workspaces";
import type { WorkspaceSummary } from "./types";

/** Self sign-up: a new workspace waiting for approval, with the person signing up as its owner. */
export async function signup(s: { company: string; name: string; email: string; username: string; password: string; modules?: ModuleKey[] }) {
  const company = s.company.trim();
  const name = s.name.trim();
  const email = s.email.trim().toLowerCase();
  const username = s.username.trim().toLowerCase();
  if (company.length < 2) return { error: "Enter your company or brand name." };
  if (!name) return { error: "Enter your name." };
  if (!EMAIL.test(email)) return { error: "That email doesn't look right." };
  if (!USERNAME.test(username)) return { error: "Username: 3–32 characters, letters, numbers, dot, dash or underscore." };
  if (s.password.length < 8) return { error: "Password must be at least 8 characters." };
  if (await usernameTaken(username)) return { error: "That username is taken. Try another." };
  if (await emailTaken(email)) return { error: "An account with that email already exists. Sign in instead." };

  const modules: ModuleKey[] = s.modules?.length ? s.modules : ["whatsapp"];
  const ws = await createWorkspace({ name: company, status: "pending", modules, contactName: name, contactEmail: email });
  try {
    await sb("app_users", {
      method: "POST",
      body: { workspace_id: ws.id, username, display_name: name, email, password_hash: hashPassword(s.password), role: "owner", modules, active: true },
    });
  } catch (err) {
    await sb(`workspaces?id=eq.${encodeURIComponent(ws.id)}`, { method: "DELETE" }).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return { error: /duplicate|unique/i.test(msg) ? "That username or email is already taken." : "Couldn't create your account. Try again." };
  }
  return { workspace: ws };
}

interface StatRow { workspace_id: string; users: number; conversations: number; last_activity: string | null }

/** Every workspace with headline numbers, for the admin console. */
export async function workspaceSummaries(): Promise<WorkspaceSummary[]> {
  const [list, stats] = await Promise.all([listWorkspaces(), sb<StatRow[]>("rpc/workspace_stats", { method: "POST", body: {} })]);
  const byId = new Map(stats.map((s) => [s.workspace_id, s]));
  return list.map((w) => {
    const s = byId.get(w.id);
    return {
      ...publicInfo(w),
      users: Number(s?.users ?? 0),
      conversations: Number(s?.conversations ?? 0),
      lastActivityAt: s?.last_activity ? new Date(s.last_activity).toISOString() : undefined,
      connected: { whatsapp: Boolean(twilioCreds(w)), calls: Boolean(retellCreds(w)) },
    };
  });
}
