"use client";
import { useEffect, useRef, useState } from "react";
import type { Conversation, LeadStage, Priority } from "./types";

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export type LiveEvent = { type: string; conversationId?: string };
type Listener = (e: LiveEvent) => void;

// One EventSource for the whole app. Bursts of events (a message, its status, the agent's log entry)
// are batched for a moment and de-duplicated, so screens reload once instead of three times.
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<string, LiveEvent>();

function deliver(e: LiveEvent) {
  pending.set(`${e.type}|${e.conversationId ?? ""}`, e);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    const batch = [...pending.values()];
    pending.clear();
    for (const ev of batch) for (const l of listeners) l(ev);
  }, 120);
}

function connect() {
  es = new EventSource("/api/whatsapp/events");
  es.onmessage = (m) => {
    try { deliver(JSON.parse(m.data)); } catch {}
  };
  es.onerror = () => {
    es?.close();
    es = null;
    retry = setTimeout(connect, 3000);
  };
}

function start() {
  connect();
  // Safety net in case the event stream is buffered by a proxy; skipped while the tab is hidden.
  poll = setInterval(() => document.visibilityState === "visible" && deliver({ type: "poll" }), 20_000);
}
function stop() {
  es?.close();
  es = null;
  clearTimeout(retry);
  clearInterval(poll);
}

/** Subscribe to live server events (new messages, status updates, agent activity, lead changes). */
export function useLive(onEvent: Listener) {
  const ref = useRef(onEvent);
  useEffect(() => { ref.current = onEvent; });
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    if (!listeners.size) start();
    listeners.add(l);
    return () => {
      listeners.delete(l);
      if (!listeners.size) stop();
    };
  }, []);
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function displayName(c: { name: string; profileName: string; phone: string }) {
  return c.name || c.profileName || c.phone;
}

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/);
  if (!parts[0]) return "#";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export const STAGE_META: Record<LeadStage, { label: string; dot: string; chip: string }> = {
  new: { label: "New", dot: "bg-ink-3", chip: "bg-panel-2 text-ink-2" },
  qualified: { label: "Qualified", dot: "bg-info", chip: "bg-info-soft text-info" },
  hot: { label: "Hot", dot: "bg-brand", chip: "bg-brand-soft text-brand" },
  won: { label: "Won", dot: "bg-ok", chip: "bg-ok-soft text-ok" },
  lost: { label: "Lost", dot: "bg-ink-3/40", chip: "bg-panel-2 text-ink-3" },
};

/** Text colour for a 0–100 lead score. */
export function scoreTone(score: number) {
  return score >= 70 ? "text-brand" : score >= 40 ? "text-warn" : "text-ink-3";
}

export const PRIORITY_META: Record<Priority, { label: string; chip: string; hint: string }> = {
  P1: { label: "P1", chip: "bg-danger text-white", hint: "Act now" },
  P2: { label: "P2", chip: "bg-warn-soft text-warn", hint: "Qualified — follow up today" },
  P3: { label: "P3", chip: "bg-panel-2 text-ink-2", hint: "Early stage — nurture" },
  P4: { label: "P4", chip: "bg-panel-2 text-ink-3", hint: "Not a sales lead" },
};

type RankInput = Pick<Conversation, "status" | "unread" | "needsHuman" | "lastInboundAt" | "lastMessageAt" | "lead">;

/** When the customer is waiting for our reply (their message is the latest), since when. */
export function waitingSince(c: Pick<Conversation, "status" | "lastInboundAt" | "lastMessageAt">): string | null {
  if (c.status !== "open" || !c.lastInboundAt) return null;
  return c.lastInboundAt >= c.lastMessageAt ? c.lastInboundAt : null;
}

/**
 * Who to talk to first: the AI score, boosted by urgency, priority, a waiting customer,
 * unread messages and handoffs; resolved chats sink to the bottom.
 */
export function priorityRank(c: RankInput, now = Date.now()): number {
  if (c.status === "resolved") return -1000 + (c.lead?.score ?? 0);
  const l = c.lead;
  let r = l?.score ?? 20;
  r += { P1: 40, P2: 15, P3: 0, P4: -40 }[l?.priority ?? "P3"];
  r += { high: 15, medium: 5, low: 0 }[l?.urgency ?? "low"];
  if (c.needsHuman) r += 25;
  r += Math.min(3, c.unread) * 4;
  const w = waitingSince(c);
  if (w) r += Math.min(20, (now - new Date(w).getTime()) / 60_000 / 6); // up to +20 after 2h of waiting
  return r;
}

/** "Waiting 2h" pill tone: fine, getting late, overdue. */
export function waitTone(sinceIso: string, priority?: Priority) {
  const mins = (Date.now() - new Date(sinceIso).getTime()) / 60_000;
  const target = priority === "P1" ? 15 : priority === "P2" ? 60 : 240;
  return mins >= target ? "bg-danger-soft text-danger" : mins >= target / 2 ? "bg-warn-soft text-warn" : "bg-panel-2 text-ink-2";
}

// ---------- the agent's name ----------
// Each workspace names its AI agent (default "Freya"). Every screen shows that name instead of "AI".
const DEFAULT_AGENT_NAME = "Freya";
let agentName: string | null = null;
let loadingName: Promise<void> | null = null;
const nameSubs = new Set<(n: string) => void>();

function setAgentName(n: string) {
  agentName = n.trim() || DEFAULT_AGENT_NAME;
  nameSubs.forEach((f) => f(agentName!));
}
function loadAgentName() {
  loadingName ??= api<{ settings: { agentName?: string } }>("/api/whatsapp/settings")
    .then((r) => setAgentName(r.settings.agentName ?? ""))
    .catch(() => {})
    .finally(() => { loadingName = null; });
  return loadingName;
}

/** The workspace's agent name, e.g. "Freya". Updates live when it's renamed on the AI agent page. */
export function useAgentName(): string {
  const [name, setName] = useState(agentName ?? DEFAULT_AGENT_NAME);
  useEffect(() => {
    nameSubs.add(setName);
    if (agentName === null) void loadAgentName();
    return () => { nameSubs.delete(setName); };
  }, []);
  useLive((e) => { if (e.type === "settings") void loadAgentName(); });
  return name;
}
