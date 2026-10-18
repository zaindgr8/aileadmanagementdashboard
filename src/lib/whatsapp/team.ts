import "server-only";
import { q, sb } from "../supabase";
import type { Agent, Note } from "./types";
import { emit } from "./store";
import { hashPassword } from "../auth/users";
import { workspaceId, wsFilter } from "../tenant/context";

export { hashPassword };

// Teammates are the workspace's app_users rows with the WhatsApp module. Notes and assignment events live in conversation_notes.

interface UserRow { username: string; display_name: string; role: Agent["role"]; modules: string[]; active: boolean; wa_available: boolean }

export async function listAgents(): Promise<Agent[]> {
  const w = await wsFilter();
  const [users, open] = await Promise.all([
    sb<UserRow[]>(`app_users?${w}&select=username,display_name,role,modules,active,wa_available&order=display_name.asc`),
    sb<{ assignee: string }[]>(`conversations?${w}&select=assignee&status=eq.open&assignee=not.is.null`),
  ]);
  const counts = new Map<string, number>();
  for (const r of open) counts.set(r.assignee, (counts.get(r.assignee) ?? 0) + 1);
  return users
    .filter((u) => u.modules.includes("whatsapp"))
    .map((u) => ({ username: u.username, name: u.display_name || u.username, role: u.role, active: u.active, available: u.wa_available, open: counts.get(u.username) ?? 0 }));
}

export async function createAgent(a: { username: string; name: string; password: string; role: Agent["role"]; modules: string[]; email?: string }) {
  const ws = await workspaceId();
  await sb("app_users", {
    method: "POST",
    body: {
      workspace_id: ws, username: a.username, display_name: a.name, password_hash: hashPassword(a.password),
      role: a.role, modules: a.modules, active: true, ...(a.email ? { email: a.email } : {}),
    },
  });
  emit(ws, "team");
}

export async function updateAgent(username: string, patch: { available?: boolean; active?: boolean; role?: Agent["role"]; name?: string; password?: string }) {
  const ws = await workspaceId();
  const w = await wsFilter();
  const body: Record<string, unknown> = {};
  if (patch.available !== undefined) body.wa_available = patch.available;
  if (patch.active !== undefined) body.active = patch.active;
  if (patch.role) body.role = patch.role;
  if (patch.name !== undefined) body.display_name = patch.name;
  if (patch.password) body.password_hash = hashPassword(patch.password);
  body.updated_at = new Date().toISOString();
  await sb(`app_users?${w}&username=eq.${q(username)}`, { method: "PATCH", body });
  // A deactivated agent shouldn't keep chats nobody else can see.
  if (patch.active === false) await sb(`conversations?${w}&assignee=eq.${q(username)}`, { method: "PATCH", body: { assignee: null, assigned_at: null } });
  emit(ws, "team");
}

// ---------- notes ----------
interface NoteRow { id: string; conversation_id: string; author: string; author_name: string; body: string; mentions: string[]; kind: Note["kind"]; created_at: string }
const toNote = (r: NoteRow): Note => ({
  id: r.id, conversationId: r.conversation_id, author: r.author, authorName: r.author_name, body: r.body,
  mentions: r.mentions ?? [], kind: r.kind, createdAt: new Date(r.created_at).toISOString(),
});

export async function listNotes(conversationId: string): Promise<Note[]> {
  return (await sb<NoteRow[]>(`conversation_notes?${await wsFilter()}&conversation_id=eq.${q(conversationId)}&select=*&order=created_at.asc`)).map(toNote);
}

export async function addNote(n: { conversationId: string; author: string; authorName: string; body: string; kind?: Note["kind"] }): Promise<Note> {
  const ws = await workspaceId();
  const mentions = [...new Set([...n.body.matchAll(/@([a-z0-9._-]+)/gi)].map((m) => m[1].toLowerCase()))];
  const rows = await sb<NoteRow[]>("conversation_notes", {
    method: "POST",
    body: { workspace_id: ws, conversation_id: n.conversationId, author: n.author, author_name: n.authorName, body: n.body, mentions, kind: n.kind ?? "note" },
    prefer: "return=representation",
  });
  emit(ws, "note", n.conversationId);
  return toNote(rows[0]);
}
