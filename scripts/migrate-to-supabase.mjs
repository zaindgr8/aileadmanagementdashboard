// Copy chats from the old JSON store (storage/db.json) into Supabase. Safe to re-run.
//   node --env-file=.env.local scripts/migrate-to-supabase.mjs [path/to/db.json]
import fs from "node:fs";

const file = process.argv[2] || `${process.env.DATA_DIR || "./storage"}/db.json`;
const BASE = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!BASE || !KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. in .env.local).");

const db = JSON.parse(fs.readFileSync(file, "utf8"));

async function upsert(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${BASE}/rest/v1/${table}`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  }
  console.log(`${table}: ${rows.length}`);
}

const conversations = Object.values(db.conversations ?? {}).map((c) => ({
  id: c.id,
  phone: c.phone ?? c.id.replace(/^whatsapp:/, ""),
  profile_name: c.profileName ?? "",
  name: c.name ?? "",
  ai_enabled: c.aiEnabled ?? true,
  needs_human: c.needsHuman ?? false,
  handoff_reason: c.handoffReason ?? null,
  status: c.status ?? "open",
  unread: c.unread ?? 0,
  tags: c.tags ?? [],
  notes: c.notes ?? "",
  last_message_at: c.lastMessageAt,
  last_message_preview: c.lastMessagePreview ?? "",
  last_inbound_at: c.lastInboundAt ?? null,
  created_at: c.createdAt,
  lead: c.lead ?? null,
}));

const known = new Set(conversations.map((c) => c.id));
const messages = (db.messages ?? [])
  .filter((m) => known.has(m.conversationId))
  .map((m) => ({
    id: m.id,
    conversation_id: m.conversationId,
    direction: m.direction,
    author: m.author,
    body: m.body ?? "",
    media: m.media ?? [],
    status: m.status ?? "",
    error: m.error ?? null,
    created_at: m.createdAt,
  }));

const events = (db.agentEvents ?? []).map((e) => ({
  id: e.id,
  conversation_id: e.conversationId,
  at: e.at,
  type: e.type,
  detail: e.detail ?? "",
  model: e.model ?? null,
  latency_ms: e.latencyMs ?? null,
  input_tokens: e.inputTokens ?? null,
  output_tokens: e.outputTokens ?? null,
}));

await upsert("conversations", conversations);
await upsert("messages", messages);
await upsert("agent_events", events);
if (db.settings) await upsert("settings", [{ id: 1, data: db.settings }]);
console.log("Done.");
