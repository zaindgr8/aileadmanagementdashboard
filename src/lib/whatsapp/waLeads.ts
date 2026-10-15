import "server-only";
import { sbAll } from "../supabase";

// Freya's WhatsApp lead profiles. The n8n workflow upserts them into `wa_leads` (same Supabase
// project as the chats, see supabase/schema.sql) after every message; the Leads page reads them here.
export interface WaLead {
  phone: string;
  name: string;
  wa_name: string;
  query: string;
  association: string;
  interest: string;
  business_owner: string;
  stage: string;
  handoff: boolean;
  notes: string;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

export const WA_LEAD_COLUMNS = [
  "phone", "name", "wa_name", "query", "association", "interest",
  "business_owner", "stage", "handoff", "notes", "last_seen",
] as const;

export function listWaLeads(): Promise<WaLead[]> {
  return sbAll<WaLead>("wa_leads?select=*&order=last_seen.desc.nullslast");
}
