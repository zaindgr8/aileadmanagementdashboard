export type Sentiment = 'Positive' | 'Neutral' | 'Negative' | 'Unknown';

/** Trimmed-down call record sent to the browser (heavy fields stripped). */
export interface LeanCall {
  id: string;
  type?: string;
  agent_id: string;
  agent_name?: string;
  status: 'registered' | 'not_connected' | 'ongoing' | 'ended' | 'error' | string;
  start?: number;
  end?: number;
  duration_ms: number;
  reason?: string;
  cost_cents: number;
  from?: string;
  to?: string;
  direction?: string;
  batch_call_id?: string;
  sentiment?: Sentiment | string;
  successful?: boolean;
  voicemail?: boolean;
  summary?: string;
  custom?: Record<string, unknown>;
  vars?: Record<string, string>;
  latency_p50?: number;
}

export interface CallDetail extends LeanCall {
  analysis?: { custom_analysis_data?: Record<string, unknown> } & Record<string, unknown>;
  recording_url?: string;
  transcript: { role: string; content: string; at?: number }[];
  cost_breakdown?: { product: string; cost: number }[];
}

export interface Agent {
  agent_id: string;
  agent_name: string;
  voice_name?: string;
  voice_avatar_url?: string;
  published_version?: number;
}

export interface PhoneNumber {
  phone_number: string;
  pretty: string;
  nickname?: string;
  outbound_agent_id?: string;
}

export interface Concurrency {
  current_concurrency: number;
  concurrency_limit: number;
}

export interface DashboardConfig {
  agents: Agent[];
  phoneNumbers: PhoneNumber[];
  concurrency: Concurrency | null;
  restricted: boolean;
  /** True when an Anthropic key is configured, enabling AI lead briefs. */
  aiEnabled: boolean;
}

export interface CallTimeWindow {
  windows: { start: number; end: number }[];
  timezone: string;
  day?: string[];
}

export interface Batch {
  batch_call_id: string;
  name: string;
  from_number: string;
  agent_id: string | null;
  agent_name: string | null;
  total: number;
  skipped: number;
  scheduled_at: number;
  created_at: number;
  window: CallTimeWindow | null;
  // Live stats (only on recent batches)
  placed?: number;
  ended?: number;
  /** Ended calls where a person actually talked (not voicemail / no answer). */
  answered?: number;
  ongoing?: number;
  not_connected?: number;
  successful?: number;
  cost_cents?: number;
  statsError?: boolean;
}

// ---------- Leads ----------

export type LeadStage = 'new' | 'attempted' | 'engaged' | 'qualified' | 'proposal' | 'won' | 'lost';
export type Temperature = 'hot' | 'warm' | 'cold';

export interface LeadNote { id: string; at: number; text: string }

/** AI-written lead brief, cached on the lead until new calls come in. */
export interface LeadBrief {
  at: number;
  /** Number of calls the brief was written from, so the UI can flag it as stale. */
  calls: number;
  summary: string;
  intent: 'high' | 'medium' | 'low' | 'none';
  suggested_stage: LeadStage;
  next_action: string;
  talking_points: string[];
  objections: string[];
  best_follow_up: string;
}

/** What the dashboard stores about a lead. Everything else is derived from calls. */
export interface LeadRecord {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  stage?: LeadStage;
  stage_at?: number;
  value?: number;
  tags?: string[];
  notes?: LeadNote[];
  follow_up_at?: number | null;
  source?: string;
  created_at: number;
  updated_at?: number;
  /** Hidden from the pipeline; calls from this number won't bring it back. */
  archived?: boolean;
  brief?: LeadBrief;
}

export interface Lead {
  phone: string;
  name: string;
  email?: string;
  company?: string;
  stage: LeadStage;
  /** Stage the calls alone would give this lead. */
  auto_stage: LeadStage;
  stage_manual: boolean;
  value?: number;
  tags: string[];
  notes_count: number;
  follow_up_at?: number | null;
  source: string;
  created_at: number;
  first_contact?: number;
  last_contact?: number;
  calls: number;
  answered: number;
  inbound: number;
  outbound: number;
  talk_ms: number;
  cost_cents: number;
  last_outcome?: string;
  last_sentiment?: string;
  last_summary?: string;
  last_agent?: string;
  successful: boolean;
  live: boolean;
  score: number;
  temperature: Temperature;
  score_reasons: string[];
  next_action: { text: string; urgency: 'high' | 'medium' | 'low' };
  has_brief: boolean;
  /** True when calls arrived after the AI brief was written. */
  brief_stale: boolean;
  archived: boolean;
}

export interface LeadDetail extends Lead {
  notes: LeadNote[];
  history: LeanCall[];
  brief?: LeadBrief;
}
