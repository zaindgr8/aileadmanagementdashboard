import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Message, Settings } from "./types";
import { getConversation, getMessages, getSettings, logAgentEvent, updateConversation } from "./store";
import { sendWhatsApp } from "./twilio";

const HANDOFF = "[[HANDOFF]]";
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

export const aiConfigured = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

function systemPrompt(s: Settings) {
  return `${s.systemPrompt.replaceAll("{{business}}", s.businessName)}

## Handoff
If the customer asks for a human, is frustrated, or needs something you cannot reliably do, reply with exactly ${HANDOFF} followed by a one-line reason for the team (the customer will not see it). Otherwise reply directly to the customer.`;
}

/** Turn the WhatsApp thread into alternating user/assistant turns for Claude. */
function toClaudeMessages(history: Message[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history) {
    if (m.author === "system" || m.status === "failed") continue;
    const role = m.direction === "inbound" ? "user" : "assistant";
    let text = m.body || (m.media.length ? `[sent ${m.media.length} attachment(s): ${m.media.map((x) => x.contentType).join(", ")}]` : "");
    if (!text) continue;
    if (m.author === "agent") text = `(human teammate) ${text}`;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content as string}\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  // Claude must answer the customer, so the thread has to end on their turn.
  while (out.length && out[out.length - 1].role !== "user") out.pop();
  return out;
}

export interface Reply {
  text: string;
  handoff: boolean;
  reason?: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export async function generateReply(conversationId: string): Promise<Reply> {
  const s = await getSettings();
  const messages = toClaudeMessages((await getMessages(conversationId)).slice(-s.historyLimit));
  if (!messages.length) throw new Error("No customer message to reply to.");

  const supportsFallback = s.model !== "claude-haiku-5-5";
  const started = Date.now();
  const res = await anthropic.beta.messages.create({
    model: s.model,
    max_tokens: 4000,
    system: systemPrompt(s),
    messages,
    output_config: { effort: s.effort },
    // Opus/Sonnet: if a safety classifier declines, the API retries on Anthropic's recommended fallback model.
    ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });

  if (res.stop_reason === "refusal") {
    return {
      text: "",
      handoff: true,
      reason: "The AI declined to answer this message.",
      model: res.model,
      latencyMs: Date.now() - started,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  }

  const text = res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  const handoff = text.includes(HANDOFF);
  return {
    text: handoff ? "" : text,
    handoff,
    reason: handoff ? text.split(HANDOFF)[1]?.trim() || "Agent requested a human." : undefined,
    model: res.model,
    latencyMs: Date.now() - started,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

function withinBusinessHours(s: Settings) {
  const { start, end, timezone } = s.businessHours;
  const now = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone || "UTC" }).format(new Date());
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

async function handoff(conversationId: string, reason: string, notifyCustomer: boolean) {
  const s = await getSettings();
  await updateConversation(conversationId, { aiEnabled: false, needsHuman: true, handoffReason: reason });
  await logAgentEvent({ conversationId, type: "handoff", detail: reason });
  if (notifyCustomer && s.handoffMessage) await sendWhatsApp({ to: conversationId, body: s.handoffMessage, author: "ai" });
}

// Customers often send several short messages in a row; wait briefly and answer them together.
const DEBOUNCE_MS = Number(process.env.AGENT_DEBOUNCE_MS ?? 2500);
const g = globalThis as typeof globalThis & { __waTimers?: Map<string, NodeJS.Timeout> };
const timers = (g.__waTimers ??= new Map());

/**
 * Decide what happens to an incoming customer message. Returns the HTTP response for Twilio
 * (n8n's response is passed through so TwiML replies from the workflow keep working).
 */
export async function onInboundMessage(conversationId: string, body: string, rawBody: string): Promise<Response | null> {
  const [s, conv] = await Promise.all([getSettings(), getConversation(conversationId)]);
  if (!conv) return null;

  const who = s.agentMode === "n8n" ? "n8n" : "AI";
  if (!s.agentEnabled) {
    await logAgentEvent({ conversationId, type: "skipped", detail: `Agent is paused globally — not sent to ${who}.` });
    return null;
  }
  if (!conv.aiEnabled) {
    await logAgentEvent({ conversationId, type: "skipped", detail: `${who} is off for this chat (human mode).` });
    return null;
  }

  const lower = body.toLowerCase();
  const keyword = s.handoffKeywords.find((k) => k && lower.includes(k.toLowerCase()));
  if (keyword) {
    await handoff(conversationId, `Customer mentioned "${keyword}".`, true).catch(console.error);
    return null;
  }

  if (s.businessHoursOnly && !withinBusinessHours(s)) {
    await sendWhatsApp({ to: conversationId, body: s.outOfHoursMessage, author: "ai" }).catch(console.error);
    await logAgentEvent({ conversationId, type: "skipped", detail: "Outside business hours — sent out-of-hours message." });
    return null;
  }

  if (s.agentMode === "n8n") return forwardToN8n(conversationId, rawBody, s.forwardUrl);

  clearTimeout(timers.get(conversationId));
  timers.set(
    conversationId,
    setTimeout(() => {
      timers.delete(conversationId);
      void runAgent(conversationId);
    }, DEBOUNCE_MS),
  );
  return null;
}

/** Pass Twilio's original webhook payload to the n8n workflow, unchanged. */
async function forwardToN8n(conversationId: string, rawBody: string, url: string): Promise<Response | null> {
  if (!url) {
    await logAgentEvent({ conversationId, type: "error", detail: "n8n webhook URL is not set (Agent page)." });
    return null;
  }
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-By": "whatsapp-dashboard" },
      body: rawBody,
      // Twilio waits up to 15s for the webhook response.
      signal: AbortSignal.timeout(Number(process.env.FORWARD_TIMEOUT_MS ?? 12_000)),
    });
    const text = await res.text();
    await logAgentEvent({
      conversationId,
      type: res.ok ? "forwarded" : "error",
      detail: res.ok ? `Sent to n8n (HTTP ${res.status}).` : `n8n returned HTTP ${res.status}: ${text.slice(0, 150)}`,
      latencyMs: Date.now() - started,
    });
    const type = res.headers.get("content-type") || "";
    // If the workflow answers with TwiML, hand it back to Twilio so the reply is delivered.
    if (res.ok && (type.includes("xml") || text.trimStart().startsWith("<Response"))) {
      return new Response(text, { headers: { "Content-Type": "text/xml" } });
    }
    return null;
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    await logAgentEvent({
      conversationId,
      type: timedOut ? "forwarded" : "error",
      detail: timedOut
        ? "Sent to n8n; it's still working (no response within 12s)."
        : `Could not reach n8n: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - started,
    });
    return null;
  }
}

async function runAgent(conversationId: string) {
  try {
    if (!aiConfigured) {
      await logAgentEvent({ conversationId, type: "error", detail: "ANTHROPIC_API_KEY is not set." });
      return;
    }
    // A teammate may have taken over while we were waiting.
    const [conv, s] = await Promise.all([getConversation(conversationId), getSettings()]);
    if (!conv?.aiEnabled || !s.agentEnabled) return;

    const r = await generateReply(conversationId);
    if (r.handoff) {
      await handoff(conversationId, r.reason!, true);
      return;
    }
    if (!r.text) return;
    await sendWhatsApp({ to: conversationId, body: r.text, author: "ai" });
    await logAgentEvent({
      conversationId,
      type: "reply",
      detail: r.text.slice(0, 200),
      model: r.model,
      latencyMs: r.latencyMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
    });
  } catch (err) {
    console.error("[agent]", err);
    await logAgentEvent({ conversationId, type: "error", detail: err instanceof Error ? err.message : String(err) }).catch(console.error);
  }
}
