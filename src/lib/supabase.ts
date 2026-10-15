import "server-only";

// Minimal Supabase (PostgREST) client. Server-only: it uses the secret key,
// which bypasses row-level security and must never reach the browser.
const BASE = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabaseConfigured = Boolean(BASE && KEY);

interface Opts {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** PostgREST Prefer header, e.g. "return=representation". */
  prefer?: string;
  range?: [number, number];
}

export async function sb<T = unknown>(path: string, { method = "GET", body, prefer, range }: Opts = {}): Promise<T> {
  if (!supabaseConfigured) throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY).");
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    cache: "no-store",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
      ...(range ? { Range: `${range[0]}-${range[1]}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Fetch every row of a query, paging past PostgREST's 1000-row cap. */
export async function sbAll<T>(path: string, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const rows = await sb<T[]>(path, { range: [from, from + page - 1] });
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

/** Encode a value for a single PostgREST filter, e.g. `id=eq.${q(id)}`. */
export function q(v: string) {
  return encodeURIComponent(v);
}

/** Quote a value inside a PostgREST list — `in.(…)` or `or=(…)` — where commas and parentheses are special. */
export function qList(v: string) {
  return encodeURIComponent(`"${v.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`);
}
