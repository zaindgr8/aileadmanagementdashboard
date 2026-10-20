import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Read a client's public website (home page plus a few key pages) as plain text, for building their agent.
// The URL comes from a user, so only public http(s) hosts are fetched (no localhost or private networks).

function privateAddress(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) websites can be read.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("That website address isn't supported.");
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("That website address isn't public.");
  const ips = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!ips.length || ips.some((r) => privateAddress(r.address))) throw new Error("That website address isn't public.");
}

async function fetchPage(start: string): Promise<{ url: string; html: string } | null> {
  let url = new URL(start);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "SixtyBot/1.0 (+https://sixty.devmatesolutions.com)", Accept: "text/html,*/*;q=0.5" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      chunks.push(value);
      if (size > 1_500_000) { await reader.cancel(); break; }
    }
    return { url: url.toString(), html: Buffer.concat(chunks).toString("utf8") };
  }
  return null;
}

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function textOf(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const desc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i.exec(html)?.[1] ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(`${title}\n${desc}\n${body}`).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

const KEY_PAGES = /(about|pricing|price|plans|services|service|product|menu|packages|faq|contact|courses|programs?)/i;

/** Home page plus up to 4 key pages (about, pricing, services, FAQ…), as text. */
export async function readWebsite(url: string, maxChars = 25_000): Promise<string> {
  const home = await fetchPage(url);
  if (!home) throw new Error("Couldn't open that website.");
  const origin = new URL(home.url).origin;
  const links = [...home.html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)]
    .map((m) => { try { return new URL(decode(m[1]), home.url); } catch { return null; } })
    .filter((u): u is URL => Boolean(u) && u!.origin === origin && KEY_PAGES.test(u!.pathname))
    .map((u) => u.origin + u.pathname)
    .filter((v, i, a) => a.indexOf(v) === i && v !== home.url)
    .slice(0, 4);
  const parts = [`# ${home.url}\n${textOf(home.html)}`];
  const more = await Promise.all(links.map((l) => fetchPage(l).catch(() => null)));
  for (const p of more) if (p) parts.push(`# ${p.url}\n${textOf(p.html)}`);
  return parts.join("\n\n").slice(0, maxChars);
}
