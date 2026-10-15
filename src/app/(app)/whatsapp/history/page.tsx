"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, Download, Search, User, UserRound } from "lucide-react";
import { api } from "@/lib/whatsapp/client";
import type { Message } from "@/lib/whatsapp/types";

type Row = Message & { contact: string };

const AUTHORS = [
  { v: "all", l: "Everyone" },
  { v: "customer", l: "Customers" },
  { v: "ai", l: "AI agent" },
  { v: "agent", l: "Team" },
];

export default function HistoryPage() {
  const [q, setQ] = useState("");
  const [author, setAuthor] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<{ total: number; rows: Row[] }>({ total: 0, rows: [] });
  const [loading, setLoading] = useState(true);

  const params = () => new URLSearchParams({ q, author, ...(from ? { from } : {}), ...(to ? { to } : {}) });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the spinner while the debounced search runs
    setLoading(true);
    const t = setTimeout(() => api<{ total: number; rows: Row[] }>(`/api/whatsapp/history?${params()}`).then(setData).finally(() => setLoading(false)), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, author, from, to]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-panel px-4 py-4 md:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Chat history</h1>
            <p className="text-sm text-ink-2">Search every WhatsApp message across all conversations.</p>
          </div>
          <a href={`/api/whatsapp/history?${params()}&format=csv`} className="btn ml-auto"><Download size={16} /> Export CSV</a>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-60 flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-9" placeholder="Search messages or phone number" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select className="input w-auto" value={author} onChange={(e) => setAuthor(e.target.value)}>
            {AUTHORS.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}
          </select>
          <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
      </div>

      <div className="scroll-thin flex-1 overflow-auto px-4 py-4 md:px-8">
        <p className="mb-3 text-xs text-ink-3">{loading ? "Searching…" : `${data.total.toLocaleString()} messages${data.total > data.rows.length ? ` · showing first ${data.rows.length}` : ""}`}</p>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-panel-2 text-left text-xs text-ink-2">
              <tr>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Contact</th>
                <th className="px-4 py-2.5 font-medium">From</th>
                <th className="px-4 py-2.5 font-medium">Message</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top hover:bg-panel-2">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-2">{new Date(r.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/whatsapp?c=${encodeURIComponent(r.conversationId)}`} className="font-medium hover:text-brand">{r.contact}</Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5"><AuthorBadge a={r.author} /></td>
                  <td className="max-w-xl px-4 py-2.5"><p className="line-clamp-3 whitespace-pre-wrap">{r.body || (r.media.length ? "📎 Media" : "—")}</p></td>
                  <td className="hidden px-4 py-2.5 text-xs capitalize text-ink-2 md:table-cell">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !data.rows.length && <p className="px-4 py-14 text-center text-sm text-ink-3">No messages match.</p>}
        </div>
      </div>
    </div>
  );
}

function AuthorBadge({ a }: { a: string }) {
  if (a === "ai") return <span className="inline-flex items-center gap-1 rounded-full bg-ai-soft px-2 py-0.5 text-xs font-medium text-ai"><Bot size={12} /> AI</span>;
  if (a === "agent") return <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand"><User size={12} /> Team</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-xs font-medium text-ink-2"><UserRound size={12} /> Customer</span>;
}
