export type Author = "customer" | "ai" | "agent" | "system";
export type Direction = "inbound" | "outbound";

export interface Media {
  url: string;
  contentType: string;
}

export interface Message {
  id: string; // Twilio Message SID, or a local id for demo/failed sends
  conversationId: string;
  direction: Direction;
  author: Author;
  body: string;
  media: Media[];
  status: string; // received | queued | sent | delivered | read | failed | undelivered | demo
  createdAt: string;
  error?: string;
}

export interface Conversation {
  id: string; // customer address, e.g. "whatsapp:+15551234567"
  phone: string; // "+15551234567"
  profileName: string;
  name: string; // custom display name set in the dashboard
  aiEnabled: boolean;
  needsHuman: boolean;
  handoffReason?: string;
  status: "open" | "resolved";
  unread: number;
  tags: string[];
  notes: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastInboundAt?: string;
  createdAt: string;
  lead?: Lead;
}

export const LEAD_STAGES = ["new", "qualified", "hot", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** What the AI has learned about this contact as a sales lead. */
export interface Lead {
  stage: LeadStage;
  /** 0–100 likelihood to convert. */
  score: number;
  intent: string;
  summary: string;
  interest: string;
  budget: string;
  email: string;
  company: string;
  nextStep: string;
  /** Set when a teammate moved the stage by hand; the AI then stops changing it. */
  stageLocked?: boolean;
  source: "ai" | "rules";
  analyzedAt: string;
}

export type AgentModel = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";
export type Effort = "low" | "medium" | "high";

export type AgentMode = "n8n" | "claude";

export interface Settings {
  agentEnabled: boolean;
  /** "n8n": forward messages to your n8n workflow. "claude": the built-in Claude agent replies. */
  agentMode: AgentMode;
  forwardUrl: string;
  businessName: string;
  systemPrompt: string;
  model: AgentModel;
  effort: Effort;
  historyLimit: number;
  handoffKeywords: string[];
  handoffMessage: string;
  businessHoursOnly: boolean;
  businessHours: { start: string; end: string; timezone: string };
  outOfHoursMessage: string;
  /** Score and summarise every chat as a lead after new customer messages. */
  leadScoring: boolean;
  /** What a qualified lead looks like for this business (fed to the scorer). */
  leadCriteria: string;
}

export type AgentEventType = "reply" | "forwarded" | "handoff" | "skipped" | "error";

export interface AgentEvent {
  id: string;
  conversationId: string;
  at: string;
  type: AgentEventType;
  detail: string;
  model?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface DB {
  settings: Settings;
  conversations: Record<string, Conversation>;
  messages: Message[];
  agentEvents: AgentEvent[];
}
