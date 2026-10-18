import "server-only";
import { getConversation, getSettings, updateConversation, updateSettings } from "./store";
import { addNote, listAgents } from "./team";
import type { Agent, AssignmentSettings, Conversation } from "./types";
import { workspaceId } from "../tenant/context";

// Auto-assignment, like respond.io's "round-robin" and "least open contacts" strategies.

/** Pick an agent for a chat according to the rules, or null if nobody fits. */
export function pickAgent(agents: Agent[], rules: AssignmentSettings): Agent | null {
  const pool = agents
    .filter((a) => a.active && (!rules.onlyAvailable || a.available))
    .filter((a) => !rules.capacity || a.open < rules.capacity)
    .sort((a, b) => a.username.localeCompare(b.username));
  if (!pool.length) return null;
  if (rules.mode === "least_busy") return [...pool].sort((a, b) => a.open - b.open || a.username.localeCompare(b.username))[0];
  // Round-robin: the next agent after the last one picked.
  const i = rules.lastAssigned ? pool.findIndex((a) => a.username > rules.lastAssigned!) : 0;
  return pool[i === -1 ? 0 : i];
}

function qualifies(c: Conversation, when: AssignmentSettings["when"]) {
  if (when === "all") return true;
  const stage = c.lead?.stage;
  if (when === "hot") return stage === "hot" || c.lead?.priority === "P1";
  return stage === "qualified" || stage === "hot" || c.lead?.priority === "P1" || c.lead?.priority === "P2";
}

// Two inbound messages arriving together must not assign the same chat twice.
const g = globalThis as typeof globalThis & { __assigning?: Set<string> };
const busy = (g.__assigning ??= new Set());

/** Auto-assign an open, unassigned chat if the rules say so. Returns the agent's username. */
export async function autoAssign(conversationId: string): Promise<string | null> {
  const rules = (await getSettings()).assignment;
  const key = `${await workspaceId()}:${conversationId}`;
  if (rules.mode === "off" || busy.has(key)) return null;
  busy.add(key);
  try {
    const c = await getConversation(conversationId);
    if (!c || c.assignee || c.status !== "open" || !qualifies(c, rules.when)) return null;
    const agent = pickAgent(await listAgents(), rules);
    if (!agent) return null;
    await updateConversation(conversationId, { assignee: agent.username, assignedAt: new Date().toISOString() });
    if (rules.mode === "round_robin") await updateSettings({ assignment: { ...rules, lastAssigned: agent.username } });
    const how = rules.mode === "round_robin" ? "round-robin" : "least busy";
    await addNote({ conversationId, author: "system", authorName: "System", kind: "event", body: `Auto-assigned to ${agent.name} (${how})` });
    return agent.username;
  } finally {
    busy.delete(key);
  }
}
