import "server-only";

// Minimal Gemini client (REST, no SDK). Server-only: the key must never reach the browser.
// Set GEMINI_API_KEY (and optionally GEMINI_MODEL) in .env.local.
const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
/** Default model for scoring, briefs and anything that doesn't pick its own. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
export const geminiConfigured = Boolean(KEY);

/** Models offered in settings (all verified to support generateContent + thinking levels). */
export const GEMINI_MODELS = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", note: "Newest, fast and smart (recommended)" },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", note: "Fast and dependable" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", note: "Deepest reasoning, slower" },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", note: "Fastest, lowest cost" },
] as const;
export type GeminiModel = (typeof GEMINI_MODELS)[number]["id"];
export type ThinkingLevel = "low" | "medium" | "high";

// AI Studio keys work on generativelanguage.googleapis.com; Vertex AI "express mode" keys work on
// aiplatform.googleapis.com. Try the first, fall back to the second, and remember which one answered.
const ENDPOINTS = [
  (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  (model: string) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`,
];
const g = globalThis as typeof globalThis & { __geminiEndpoint?: number };

/** OpenAPI-style schema Gemini understands (types in upper case). */
export type GeminiSchema =
  | { type: "STRING"; enum?: readonly string[]; description?: string }
  | { type: "INTEGER" | "NUMBER" | "BOOLEAN"; description?: string }
  | { type: "ARRAY"; items: GeminiSchema; description?: string; maxItems?: number }
  | { type: "OBJECT"; properties: Record<string, GeminiSchema>; required?: readonly string[]; propertyOrdering?: readonly string[]; description?: string };

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string; status?: string };
}

export class GeminiError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

/** One generateContent call with endpoint fallback. */
async function generate(model: string, payload: object, timeoutMs: number): Promise<GeminiResponse> {
  if (!KEY) throw new GeminiError("GEMINI_API_KEY is not set.", 503);
  const body = JSON.stringify(payload);
  const order = g.__geminiEndpoint != null ? [g.__geminiEndpoint, ...ENDPOINTS.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...ENDPOINTS.keys()];
  let lastError = "";
  for (const i of order) {
    let res: Response;
    try {
      res = await fetch(ENDPOINTS[i](model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new GeminiError(`Couldn't reach Gemini: ${err instanceof Error ? err.message : err}`);
    }
    const json = (await res.json().catch(() => ({}))) as GeminiResponse;
    // A key for the other endpoint is rejected as unauthorised / invalid: try the next one.
    if ((res.status === 400 || res.status === 401 || res.status === 403) && /api key|unauthenticated|permission|credential/i.test(json.error?.message ?? "")) {
      lastError = json.error?.message ?? `HTTP ${res.status}`;
      continue;
    }
    if (res.status === 429) throw new GeminiError("Gemini is busy (rate limit). Try again in a minute.", 429);
    if (!res.ok) throw new GeminiError(`Gemini ${res.status}: ${json.error?.message ?? "request failed"}`);
    g.__geminiEndpoint = i;
    return json;
  }
  throw new GeminiError(`Gemini rejected the API key: ${lastError}`, 503);
}

const textOf = (r: GeminiResponse) => r.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "";
const blocked = (r: GeminiResponse) => Boolean(r.promptFeedback?.blockReason) || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(r.candidates?.[0]?.finishReason ?? "");

/** Ask Gemini for JSON matching `schema`. Throws GeminiError with a readable message on failure. */
export async function geminiJson<T>(opts: {
  system: string; prompt: string; schema: GeminiSchema; model?: string; thinking?: ThinkingLevel; temperature?: number; timeoutMs?: number;
}): Promise<{ data: T; model: string; tokens: number }> {
  const model = opts.model ?? GEMINI_MODEL;
  const r = await generate(model, {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      thinkingConfig: { thinkingLevel: opts.thinking ?? "low" },
    },
  }, opts.timeoutMs ?? 45_000);
  if (blocked(r)) throw new GeminiError("Gemini declined to answer this request.", 422);
  const text = textOf(r);
  if (!text) throw new GeminiError(`Gemini returned no answer (${r.candidates?.[0]?.finishReason ?? "unknown"}).`);
  try {
    return { data: JSON.parse(text) as T, model, tokens: (r.usageMetadata?.promptTokenCount ?? 0) + (r.usageMetadata?.candidatesTokenCount ?? 0) };
  } catch {
    throw new GeminiError("Gemini returned text that isn't valid JSON.");
  }
}

export interface ChatTurn { role: "user" | "model"; text: string }

/** A chat reply. `blocked` is true when Gemini's safety filters declined (treat it like a handoff). */
export async function geminiChat(opts: {
  system: string; turns: ChatTurn[]; model?: string; thinking?: ThinkingLevel; temperature?: number; maxOutputTokens?: number; timeoutMs?: number;
}): Promise<{ text: string; blocked: boolean; model: string; inputTokens: number; outputTokens: number }> {
  const model = opts.model ?? GEMINI_MODEL;
  const r = await generate(model, {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: opts.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      // Thinking tokens count towards the limit, so leave room for them.
      maxOutputTokens: opts.maxOutputTokens ?? 4000,
      thinkingConfig: { thinkingLevel: opts.thinking ?? "low" },
    },
  }, opts.timeoutMs ?? 45_000);
  return {
    text: textOf(r).trim(),
    blocked: blocked(r),
    model,
    inputTokens: r.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: (r.usageMetadata?.candidatesTokenCount ?? 0) + (r.usageMetadata?.thoughtsTokenCount ?? 0),
  };
}
