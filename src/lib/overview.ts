// Shapes returned by /api/overview (the Home page).
export type Channel = 'whatsapp' | 'calls';

export interface Contact {
  phone: string;
  name: string;
  channels: Channel[];
  /** Highest lead score across channels, 0–100. */
  score: number | null;
  lastTouch: number;
  summary?: string;
  nextAction?: string;
  waId?: string;
  waStage?: string;
  waProfileStage?: string;
  callStage?: string;
}

export interface Attention { kind: Channel; phone: string; name: string; text: string; href: string }

type Failed = { error: string };

export interface WhatsAppSummary {
  conversations: number;
  open: number;
  unread: number;
  needsHuman: number;
  activeWeek: number;
  aiActive: number;
  stages: Record<'new' | 'qualified' | 'hot' | 'won' | 'lost', number>;
  avgScore: number | null;
  profiles: number;
}

export interface CallsSummary {
  calls30d: number;
  answered30d: number;
  answerRate: number | null;
  talkMs: number;
  costCents: number;
  live: number;
  leads: number;
  hot: number;
  followUpsDue: number;
  won: number;
}

export interface Overview {
  whatsapp: WhatsAppSummary | Failed | null;
  calls: CallsSummary | Failed | null;
  contacts: Contact[];
  attention: Attention[];
}

export const failed = (v: unknown): v is Failed => !!v && typeof v === 'object' && 'error' in v;
