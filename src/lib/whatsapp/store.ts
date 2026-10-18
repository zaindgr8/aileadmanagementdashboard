import "server-only";
import { EventEmitter } from "node:events";
import type { AgentEvent, Conversation, Message, Settings } from "./types";
import { q, qList, sb, sbAll } from "../supabase";
import { workspaceId, wsFilter as ws } from "../tenant/context";
import { currentWorkspace } from "../tenant/workspaces";

// All chats, messages, settings and agent activity live in Supabase (see supabase/whatsapp.sql),
// so every server instance — local or on Vercel — reads the same data and nothing is lost on restart.
// Every row belongs to a workspace (client account); each query below is limited to the current one.

export const DEFAULT_SETTINGS: Settings = {
  agentEnabled: true,
  agentMode: "builtin",
  forwardUrl: "",
  businessName: "My Business",
  systemPrompt: `You are the friendly WhatsApp assistant for {{business}}.

- Reply in the customer's language, in short WhatsApp-style messages (1-3 sentences).
- Be warm, clear and helpful. Use plain text; avoid markdown headings and tables.
- Never invent prices, policies, order details or availability. If you don't know, say a teammate will follow up.
- If the customer asks for a human, is upset, or needs something you can't do, hand off.`,
  model: "gemini-3.8-flash",
  effort: "low",
  historyLimit: 30,
  handoffKeywords: ["human", "agent", "representative", "talk to someone"],
  handoffMessage: "Thanks! I'm connecting you with a member of our team — they'll reply here shortly.",
  businessHoursOnly: false,
  businessHours: { start: "09:00", end: "18:00", timezone: "UTC" },
  outOfHoursMessage: "Thanks for your message! We're currently closed and will get back to you during business hours.",
  leadScoring: true,
  leadCriteria: `A qualified lead has a clear need we can solve and shares contact details or asks about pricing.
A hot lead mentions budget, a timeline, or asks to book a call or meeting.`,
  assignment: { mode: "off", when: "all", capacity: 0, onlyAvailable: true, unassignOnResolve: false },
};

type Global = typeof globalThis & { __waBus?: EventEmitter };
const g = globalThis as Global;

// Live updates for dashboards connected to this server instance. Other instances
// (e.g. on Vercel) pick changes up through the client's regular refresh.
export const bus: EventEmitter = g.__waBus ?? (g.__waBus = new EventEmitter());
bus.setMaxListeners(100);

/** Tell this workspace's open dashboards that something changed. */
export function emit(workspace: string, type: string, conversationId?: string) {
  bus.emit("change", { workspace, type, conversationId });
}

// Postgres returns "2026-10-15T13:43:34.553+00:00"; the app compares ISO strings, so keep them in "…Z" form.
const iso = (v: string) => new Date(v).toISOString();
const isoOpt = (v: string | null) => (v ? iso(v) : undefined);

// ---------- row mapping ----------
interface ConvRow {
  id: string;
  phone: string;
  profile_name: string;
  name: string;
  ai_enabled: boolean;
  needs_human: boolean;
  handoff_reason: string | null;
  status: Conversation["status"];
  unread: number;
  tags: string[];
  notes: string;
  last_message_at: string;
  last_message_preview: string;
  last_inbound_at: string | null;
  created_at: string;
  lead: Conversation["lead"] | null;
  assignee: string | null;
  assigned_at: string | null;
}

function toConversation(r: ConvRow): Conversation {
  return {
    id: r.id,
    phone: r.phone,
    profileName: r.profile_name,
    name: r.name,
    aiEnabled: r.ai_enabled,
    needsHuman: r.needs_human,
    handoffReason: r.handoff_reason ?? undefined,
    status: r.status,
    unread: r.unread,
    tags: r.tags ?? [],
    notes: r.notes,
    lastMessageAt: iso(r.last_message_at),
    lastMessagePreview: r.last_message_preview,
    lastInboundAt: isoOpt(r.last_inbound_at),
    createdAt: iso(r.created_at),
    lead: r.lead ?? undefined,
    assignee: r.assignee ?? undefined,
    assignedAt: isoOpt(r.assigned_at),
  };
}

const CONV_COLUMNS: Record<keyof Conversation, keyof ConvRow> = {
  id: "id",
  phone: "phone",
  profileName: "profile_name",
  name: "name",
  aiEnabled: "ai_enabled",
  needsHuman: "needs_human",
  handoffReason: "handoff_reason",
  status: "status",
  unread: "unread",
  tags: "tags",
  notes: "notes",
  lastMessageAt: "last_message_at",
  lastMessagePreview: "last_message_preview",
  lastInboundAt: "last_inbound_at",
  createdAt: "created_at",
  lead: "lead",
  assignee: "assignee",
  assignedAt: "assigned_at",
};

/** Map a partial Conversation to columns. A key set to undefined clears the column. */
export function conversationRow(patch: Partial<Conversation>): Partial<ConvRow> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = CONV_COLUMNS[k as keyof Conversation];
    if (col) row[col] = v === undefined ? null : v;
  }
  return row as Partial<ConvRow>;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: Message["direction"];
  author: Message["author"];
  body: string;
  media: Message["media"];
  status: string;
  error: string | null;
  created_at: string;
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction,
    author: r.author,
    body: r.body,
    media: r.media ?? [],
    status: r.status,
    createdAt: iso(r.created_at),
    ...(r.error ? { error: r.error } : {}),
  };
}

interface AgentEventRow {
  id: string;
  conversation_id: string;
  at: string;
  type: AgentEvent["type"];
  detail: string;
  model: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

function toAgentEvent(r: AgentEventRow): AgentEvent {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    at: iso(r.at),
    type: r.type,
    detail: r.detail,
    model: r.model ?? undefined,
    latencyMs: r.latency_ms ?? undefined,
    inputTokens: r.input_tokens ?? undefined,
    outputTokens: r.output_tokens ?? undefined,
  };
}

// ---------- settings ----------
/** Defaults for a workspace that hasn't saved settings yet. */
async function defaults(): Promise<Settings> {
  const w = await currentWorkspace();
  const n8n = w.isPrimary ? process.env.N8N_WEBHOOK_URL || "" : "";
  return { ...DEFAULT_SETTINGS, businessName: w.name, agentMode: n8n ? "n8n" : "builtin", forwardUrl: n8n };
}

export async function getSettings(): Promise<Settings> {
  const [rows, base] = await Promise.all([sb<{ data: Partial<Settings> }[]>(`settings?${await ws()}&select=data`), defaults()]);
  const raw: Record<string, unknown> = { ...(rows[0]?.data ?? {}) };
  // Settings saved before the move from Claude to Gemini.
  if (raw.agentMode === "claude") raw.agentMode = "builtin";
  if (typeof raw.model === "string" && !raw.model.startsWith("gemini-")) delete raw.model;
  const data = raw as Partial<Settings>;
  return { ...base, ...data, assignment: { ...base.assignment, ...data.assignment } };
}
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const id = await workspaceId();
  const settings = { ...(await getSettings()), ...patch };
  await sb("settings?on_conflict=workspace_id", { method: "POST", body: { workspace_id: id, data: settings }, prefer: "resolution=merge-duplicates" });
  emit(id, "settings");
  return settings;
}

// ---------- conversations ----------
export async function listConversations(): Promise<Conversation[]> {
  return (await sbAll<ConvRow>(`conversations?${await ws()}&select=*&order=last_message_at.desc`)).map(toConversation);
}
export async function countConversations(): Promise<number> {
  return (await sb<{ id: string }[]>(`conversations?${await ws()}&select=id&limit=1`)).length;
}
export async function getConversation(id: string): Promise<Conversation | undefined> {
  const rows = await sb<ConvRow[]>(`conversations?${await ws()}&id=eq.${q(id)}&select=*`);
  return rows[0] ? toConversation(rows[0]) : undefined;
}

export async function ensureConversation(id: string, profileName = ""): Promise<Conversation> {
  const w = await workspaceId();
  await sb("conversations?on_conflict=workspace_id,id", {
    method: "POST",
    body: { workspace_id: w, id, phone: id.replace(/^whatsapp:/, ""), profile_name: profileName },
    prefer: "resolution=ignore-duplicates",
  });
  if (profileName) {
    await sb(`conversations?${await ws()}&id=eq.${q(id)}&profile_name=neq.${q(profileName)}`, { method: "PATCH", body: { profile_name: profileName } });
  }
  return (await getConversation(id))!;
}

export async function updateConversation(id: string, patch: Partial<Conversation>): Promise<Conversation | undefined> {
  const { id: _ignored, ...rest } = patch;
  void _ignored;
  const w = await workspaceId();
  const rows = await sb<ConvRow[]>(`conversations?${await ws()}&id=eq.${q(id)}`, {
    method: "PATCH",
    body: conversationRow(rest),
    prefer: "return=representation",
  });
  if (!rows[0]) return undefined;
  emit(w, "conversation", id);
  return toConversation(rows[0]);
}

// ---------- messages ----------
export async function getMessages(conversationId: string): Promise<Message[]> {
  return (await sbAll<MessageRow>(`messages?${await ws()}&conversation_id=eq.${q(conversationId)}&select=*&order=created_at.asc`)).map(toMessage);
}

export async function allMessages(): Promise<Message[]> {
  return (await sbAll<MessageRow>(`messages?${await ws()}&select=*&order=created_at.asc`)).map(toMessage);
}

/** Status of each message we already have, for the given ids. */
export async function knownMessageStatuses(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const w = await ws();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await sb<{ id: string; status: string }[]>(`messages?${w}&select=id,status&id=in.(${chunk.map(qList).join(",")})`);
    for (const r of rows) out.set(r.id, r.status);
  }
  return out;
}

/** Insert or update a message and keep the conversation summary in sync (atomically, in Postgres). */
export async function upsertMessage(msg: Message, opts: { countUnread?: boolean } = {}): Promise<Message> {
  const w = await workspaceId();
  await sb("rpc/record_message", { method: "POST", body: { ws: w, m: msg, count_unread: Boolean(opts.countUnread) } });
  emit(w, "message", msg.conversationId);
  return msg;
}

export async function updateMessageStatus(id: string, status: string, error?: string) {
  const w = await workspaceId();
  const rows = await sb<{ conversation_id: string }[]>(`messages?${await ws()}&id=eq.${q(id)}&select=conversation_id`, {
    method: "PATCH",
    body: { status, ...(error ? { error } : {}) },
    prefer: "return=representation",
  });
  if (rows[0]) emit(w, "status", rows[0].conversation_id);
}

export async function searchMessages(f: { text?: string; author?: string; from?: string; to?: string; conversationId?: string }) {
  const params = [await ws(), "select=*", "order=created_at.desc"];
  if (f.conversationId) params.push(`conversation_id=eq.${q(f.conversationId)}`);
  if (f.author && f.author !== "all") params.push(`author=eq.${q(f.author)}`);
  if (f.from) params.push(`created_at=gte.${q(f.from)}`);
  if (f.to) params.push(`created_at=lte.${q(f.to)}`);
  const text = f.text?.trim();
  if (text) params.push(`or=(body.ilike.${qList(`*${text}*`)},conversation_id.ilike.${qList(`*${text}*`)})`);
  return (await sbAll<MessageRow>(`messages?${params.join("&")}`)).map(toMessage);
}

// ---------- agent activity ----------
export async function logAgentEvent(e: Omit<AgentEvent, "id" | "at">) {
  const w = await workspaceId();
  await sb("agent_events", {
    method: "POST",
    body: {
      workspace_id: w,
      conversation_id: e.conversationId,
      type: e.type,
      detail: e.detail,
      model: e.model ?? null,
      latency_ms: e.latencyMs ?? null,
      input_tokens: e.inputTokens ?? null,
      output_tokens: e.outputTokens ?? null,
    },
  });
  emit(w, "agent", e.conversationId);
}
export async function listAgentEvents(limit = 100): Promise<AgentEvent[]> {
  return (await sb<AgentEventRow[]>(`agent_events?${await ws()}&select=*&order=at.desc&limit=${limit}`)).map(toAgentEvent);
}
