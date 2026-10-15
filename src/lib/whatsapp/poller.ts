import "server-only";
import { countConversations } from "./store";
import { importHistory, twilioConfigured } from "./twilio";

// Messages your n8n workflow sends go straight through Twilio, so the dashboard
// checks Twilio regularly to show them (and their delivery status) in the chats.
const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 15_000);
const LOOKBACK_MS = 30 * 60_000;

const g = globalThis as typeof globalThis & { __waPoller?: NodeJS.Timeout; __waPolling?: boolean; __waLastSync?: number };

/** Pull recent messages from Twilio into Supabase, at most once per interval per server instance. */
export async function syncFromTwilio() {
  if (!twilioConfigured || INTERVAL_MS <= 0 || g.__waPolling) return;
  if (g.__waLastSync && Date.now() - g.__waLastSync < INTERVAL_MS) return;
  g.__waPolling = true;
  g.__waLastSync = Date.now();
  try {
    // First run on an empty dashboard: bring in the full history.
    if (!(await countConversations())) await importHistory(1000);
    else await importHistory(100, new Date(Date.now() - LOOKBACK_MS));
  } catch (err) {
    console.error("[sync]", err instanceof Error ? err.message : err);
  } finally {
    g.__waPolling = false;
  }
}

// Long-running servers (local / `next start`) check on a timer. On Vercel, timers don't
// survive between requests, so the dashboard's own refreshes also call syncFromTwilio().
export function startPoller() {
  if (!twilioConfigured || INTERVAL_MS <= 0 || g.__waPoller) return;
  g.__waPoller = setInterval(() => void syncFromTwilio(), INTERVAL_MS);
  void syncFromTwilio();
  console.log(`[sync] Checking Twilio for new WhatsApp messages every ${INTERVAL_MS / 1000}s`);
}
