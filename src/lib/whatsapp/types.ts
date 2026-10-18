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
  /** Username of the teammate handling this chat. */
  assignee?: string;
  assignedAt?: string;
  /** How the agent should handle this particular person, written by the team ("be formal", "offer 10% off"…). */
  aiInstructions?: string;
  /** "add": on top of the agent's usual instructions. "replace": the agent's whole brief for this person. */
  aiInstructionsMode?: "add" | "replace";
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
  /** "ai" = scored by the old Claude scorer (kept for older records). */
  source: "ai" | "rules" | "gemini";
  analyzedAt: string;
  // Gemini insight (present when source is "gemini").
  /** P1 = act now … P4 = not a sales lead. */
  priority?: Priority;
  /** Why the score is what it is, strongest first. */
  reasons?: { text: string; impact: "positive" | "negative" }[];
  urgency?: "high" | "medium" | "low";
  sentiment?: "positive" | "neutral" | "negative";
  category?: LeadCategory;
  language?: string;
  aiTags?: string[];
}

export const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const LEAD_CATEGORIES = ["sales", "support", "member", "partnership", "spam", "other"] as const;
export type LeadCategory = (typeof LEAD_CATEGORIES)[number];

/** A teammate who can be assigned WhatsApp chats. */
export interface Agent {
  username: string;
  name: string;
  role: "owner" | "admin" | "member";
  active: boolean;
  available: boolean;
  /** Open chats currently assigned to them. */
  open: number;
}

export type AssignMode = "off" | "round_robin" | "least_busy";
export interface AssignmentSettings {
  mode: AssignMode;
  /** Which chats get auto-assigned. */
  when: "all" | "qualified" | "hot";
  /** Max open chats per agent (0 = no limit). */
  capacity: number;
  /** Skip agents who switched themselves to away. */
  onlyAvailable: boolean;
  unassignOnResolve: boolean;
  /** Last agent picked by round-robin. */
  lastAssigned?: string;
}

export interface Note {
  id: string;
  conversationId: string;
  author: string;
  authorName: string;
  body: string;
  mentions: string[];
  kind: "note" | "event";
  createdAt: string;
}

export type AgentModel = "gemini-3.8-flash" | "gemini-3.5-flash" | "gemini-3.1-pro-preview" | "gemini-3.5-flash-lite";
export type Effort = "low" | "medium" | "high";

export type AgentMode = "n8n" | "builtin";

export interface Settings {
  agentEnabled: boolean;
  /** "n8n": forward messages to your n8n workflow. "builtin": the built-in Gemini agent replies. */
  agentMode: AgentMode;
  forwardUrl: string;
  businessName: string;
  /** What the team and customers call the agent, e.g. "Freya". Shown on every AI message. */
  agentName: string;
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
  assignment: AssignmentSettings;
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
