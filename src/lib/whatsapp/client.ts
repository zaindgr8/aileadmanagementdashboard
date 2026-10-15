"use client";
import { useEffect, useRef } from "react";
import type { LeadStage } from "./types";

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
