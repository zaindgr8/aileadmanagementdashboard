import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { LEAD_STAGES, type Lead, type LeadStage, type Message } from "./types";
import { getConversation, getMessages, getSettings, listConversations, updateConversation } from "./store";

const anthropic = new Anthropic();
const aiConfigured = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const SCHEMA = {
  type: "object",
  properties: {
    stage: { type: "string", enum: LEAD_STAGES.filter((s) => s !== "won" && s !== "lost") },
    score: { type: "integer", description: "0-100 likelihood this contact becomes a paying customer" },
    intent: { type: "string", description: "2-4 words, e.g. 'Pricing inquiry', 'Support', 'Book a demo'" },
    summary: { type: "string", description: "One sentence for the sales team: who they are and what they want" },
    interest: { type: "string", description: "Product or service they want, or empty" },
    budget: { type: "string", description: "Budget they mentioned, or empty" },
    email: { type: "string", description: "Email they shared, or empty" },
    company: { type: "string", description: "Their company, or empty" },
    nextStep: { type: "string", description: "The single best next action for the team, imperative, under 12 words" },
  },
  required: ["stage", "score", "intent", "summary", "interest", "budget", "email", "company", "nextStep"],
  additionalProperties: false,
} as const;

function transcript(history: Message[]) {
  const who = { customer: "Customer", ai: "Assistant", agent: "Team", system: "System" } as const;
  return history
    .filter((m) => m.body || m.media.length)
    .map((m) => `${who[m.author]}: ${m.body || `[${m.media.length} attachment(s)]`}`)
    .join("\n");
}

async function scoreWithClaude(conversationId: string): Promise<Omit<Lead, "analyzedAt" | "source" | "stageLocked">> {
  const s = await getSettings();
  const text = transcript((await getMessages(conversationId)).slice(-40));
  const res = await anthropic.beta.messages.create({
    model: s.model,
    max_tokens: 2000,
    system: `You qualify WhatsApp leads for ${s.businessName}. Read the chat and fill in the lead profile. Only use facts stated in the chat; leave a field empty when unknown.

Stages: "new" = no clear buying need yet; "qualified" = real need we can serve; "hot" = ready to buy (budget, timeline, or asking to book/pay).

What the business considers qualified:
${s.leadCriteria}`,
    messages: [{ role: "user", content: `<chat>\n${text}\n</chat>` }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    ...(s.model !== "claude-haiku-5-5" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  if (res.stop_reason === "refusal") throw new Error("The AI declined to score this chat.");
  const raw = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const out = JSON.parse(raw) as Omit<Lead, "analyzedAt" | "source" | "stageLocked">;
  return { ...out, score: Math.max(0, Math.min(100, Math.round(out.score))) };
}

// Used without an API key (and in demo mode): simple buying-signal rules.
const SIGNALS: [RegExp, number, string][] = [
  [/\b(price|pricing|cost|quote|how much|rate|package|plan)s?\b|قیمت|سعر/i, 18, "Pricing inquiry"],
  [/\b(buy|purchase|order|sign up|subscribe|start|hire)\b/i, 20, "Ready to buy"],
  [/\b(budget|aed|usd|\$|pkr|rs\.?)\s?\d|\d+\s?(k|aed|usd|dollars)\b/i, 22, "Budget shared"],
  [/\b(call|meeting|demo|book|schedule|appointment)\b/i, 20, "Book a call"],
  [/\b(asap|urgent|this week|today|tomorrow|deadline)\b/i, 12, "Urgent need"],
  [/\b(website|app|software|automation|marketing|seo|crm|ai)\b/i, 10, "Service inquiry"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 12, "Shared contact"],
  [/\b(refund|damaged|complaint|broken|not working)\b/i, -10, "Support issue"],
];

async function scoreWithRules(conversationId: string): Promise<Omit<Lead, "analyzedAt" | "source" | "stageLocked">> {
  const inbound = (await getMessages(conversationId)).filter((m) => m.direction === "inbound").map((m) => m.body).join("\n");
  let score = inbound ? 15 : 0;
  let intent = "General inquiry";
  let best = 0;
  for (const [re, pts, label] of SIGNALS) {
    if (re.test(inbound)) {
      score += pts;
      if (pts > best) { best = pts; intent = label; }
      if (pts < 0 && best <= 0) intent = label;
    }
  }
  score = Math.max(0, Math.min(100, score));
  const email = inbound.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? "";
  const budget = inbound.match(/(?:budget|aed|usd|\$|pkr)\s?[\d,.]+k?|\d[\d,.]*\s?(?:k|aed|usd|dollars)\b/i)?.[0] ?? "";
  const last = inbound.split("\n").filter(Boolean).pop() ?? "";
  const stage: LeadStage = score >= 65 ? "hot" : score >= 40 ? "qualified" : "new";
  return {
    stage, score, intent, email, budget, company: "", interest: "",
    summary: last ? `Last asked: “${last.slice(0, 120)}”` : "No customer messages yet.",
    nextStep: stage === "hot" ? "Call them today and send a proposal" : stage === "qualified" ? "Ask about budget and timeline" : "Find out what they need",
  };
}

/** Score a chat as a lead and save it. A stage set by hand (or won/lost) is kept. */
export async function analyzeLead(conversationId: string): Promise<Lead | undefined> {
  const conv = await getConversation(conversationId);
  if (!conv) return undefined;
  const useAi = aiConfigured;
  const next = useAi ? await scoreWithClaude(conversationId) : await scoreWithRules(conversationId);
  const prev = conv.lead;
  const keepStage = prev && (prev.stageLocked || prev.stage === "won" || prev.stage === "lost");
  const lead: Lead = {
    ...next,
    stage: keepStage ? prev.stage : next.stage,
    stageLocked: prev?.stageLocked,
    // Don't lose details the customer gave earlier if the latest read leaves them blank.
    email: next.email || prev?.email || "",
    budget: next.budget || prev?.budget || "",
    company: next.company || prev?.company || "",
    interest: next.interest || prev?.interest || "",
    source: useAi ? "ai" : "rules",
    analyzedAt: new Date().toISOString(),
  };
  await updateConversation(conversationId, { lead });
  return lead;
}

// Re-score shortly after the customer stops typing, at most once per burst of messages.
const DEBOUNCE_MS = Number(process.env.LEAD_DEBOUNCE_MS ?? 6000);
const g = globalThis as typeof globalThis & { __leadTimers?: Map<string, NodeJS.Timeout> };
const timers = (g.__leadTimers ??= new Map());

export async function scheduleLeadAnalysis(conversationId: string) {
  if (!(await getSettings()).leadScoring) return;
  clearTimeout(timers.get(conversationId));
  timers.set(conversationId, setTimeout(() => {
    timers.delete(conversationId);
    analyzeLead(conversationId).catch((err) => console.error("[leads]", err instanceof Error ? err.message : err));
  }, DEBOUNCE_MS));
}

/** Score chats that have never been scored (e.g. right after upgrading or a history import), one at a time. */
export async function backfillLeads() {
  const gg = g as typeof g & { __leadBackfill?: boolean };
  if (gg.__leadBackfill || !(await getSettings()).leadScoring) return;
  const todo = (await listConversations()).filter((c) => !c.lead && c.lastInboundAt).map((c) => c.id);
  if (!todo.length) return;
  gg.__leadBackfill = true;
  void (async () => {
    for (const id of todo) await analyzeLead(id).catch((err) => console.error("[leads]", err instanceof Error ? err.message : err));
    gg.__leadBackfill = false;
  })();
}
