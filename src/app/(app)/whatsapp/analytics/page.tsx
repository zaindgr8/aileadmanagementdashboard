"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, STAGE_META, useLive } from "@/lib/whatsapp/client";
import { LEAD_STAGES, type LeadStage } from "@/lib/whatsapp/types";

type Stats = {
  leads: { stages: Record<LeadStage, number>; avgScore: number | null; winRate: number | null; pipeline: number };
  totals: {
    conversations: number; open: number; needsHuman: number; aiActive: number;
    inbound: number; ai: number; agent: number; failed: number; automationRate: number;
    medianResponseMs: number | null; avgAiLatencyMs: number | null; handoffs: number; errors: number; tokens: number;
  };
  days: { date: string; inbound: number; ai: number; agent: number }[];
};

const fmtMs = (ms: number | null) => ms == null ? "—" : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`;

const SERIES = [
  { key: "inbound", label: "Customer messages", color: "var(--ink-3)" },
  { key: "ai", label: "AI replies", color: "var(--ai)" },
  { key: "agent", label: "Team replies", color: "var(--brand)" },
] as const;

export default function Analytics() {
  const [s, setS] = useState<Stats | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const load = useCallback(() => api<Stats>("/api/whatsapp/stats").then(setS).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useLive((e) => { if (e.type === "message" || e.type === "poll") load(); });

  if (!s) return <div className="grid h-full place-items-center text-ink-3"><Loader2 className="animate-spin" /></div>;
  const L = s.leads;
  const funnelMax = Math.max(1, ...LEAD_STAGES.map((k) => L.stages[k]));
  const t = s.totals;
  const max = Math.max(1, ...s.days.map((d) => d.inbound + d.ai + d.agent));

  const tiles = [
    { label: "Open pipeline", value: L.pipeline.toLocaleString(), sub: `${L.stages.hot} hot · ${L.stages.qualified} qualified` },
    { label: "Win rate", value: L.winRate == null ? "—" : `${L.winRate}%`, sub: `${L.stages.won} won · ${L.stages.lost} lost` },
    { label: "Avg lead score", value: L.avgScore == null ? "—" : String(L.avgScore), sub: `${t.conversations} conversations · ${t.open} open` },
    { label: "Need a human", value: t.needsHuman.toLocaleString(), sub: `${t.handoffs} handoffs total`, warn: t.needsHuman > 0 },
    { label: "Automation rate", value: `${t.automationRate}%`, sub: "replies sent by AI" },
    { label: "Median first response", value: fmtMs(t.medianResponseMs), sub: `AI generates in ${fmtMs(t.avgAiLatencyMs)}` },
    { label: "Customer messages", value: t.inbound.toLocaleString(), sub: `${t.ai} AI · ${t.agent} team replies` },
    { label: "Delivery failures", value: t.failed.toLocaleString(), sub: `${t.errors} agent errors`, warn: t.failed + t.errors > 0 },
  ];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mb-6 text-sm text-ink-2">How your leads, WhatsApp channel and AI agent are performing.</p>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((x) => (
            <div key={x.label} className="card p-4">
              <div className="text-xs font-medium text-ink-2">{x.label}</div>
              <div className={`mt-1 text-2xl font-semibold tabular-nums ${x.warn ? "text-warn" : ""}`}>{x.value}</div>
              <div className="mt-0.5 text-xs text-ink-3">{x.sub}</div>
            </div>
          ))}
        </div>

        <section className="card mb-6 p-5">
          <h2 className="mb-4 font-semibold">Lead funnel</h2>
          <div className="space-y-2.5">
            {LEAD_STAGES.map((k) => (
              <div key={k} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-ink-2">{STAGE_META[k].label}</span>
                <div className="h-7 flex-1 overflow-hidden rounded-lg bg-panel-2">
                  <div className={`h-full rounded-lg ${STAGE_META[k].dot} transition-all`} style={{ width: `${(L.stages[k] / funnelMax) * 100}%`, minWidth: L.stages[k] ? 6 : 0, opacity: k === "lost" ? 1 : 0.9 }} />
                </div>
                <span className="w-8 text-right font-semibold tabular-nums">{L.stages[k]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <h2 className="font-semibold">Messages · last 14 days</h2>
            <div className="ml-auto flex flex-wrap gap-4 text-xs text-ink-2">
              {SERIES.map((x) => <span key={x.key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: x.color }} />{x.label}</span>)}
            </div>
          </div>
          <div className="relative flex h-56 items-end gap-1.5" onMouseLeave={() => setHover(null)}>
            {s.days.map((d, i) => {
              const total = d.inbound + d.ai + d.agent;
              return (
                <div key={d.date} className="flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)}>
                  <div className={`flex flex-col-reverse overflow-hidden rounded-t-[4px] transition-opacity ${hover != null && hover !== i ? "opacity-50" : ""}`} style={{ height: `${(total / max) * 100}%`, minHeight: total ? 2 : 0 }}>
                    {SERIES.map((x) => d[x.key] > 0 && <div key={x.key} style={{ height: `${(d[x.key] / total) * 100}%`, background: x.color }} className="border-t border-panel first:border-t-0" />)}
                  </div>
                </div>
              );
            })}
            {hover != null && (
              <div className="pointer-events-none absolute top-0 rounded-lg bg-ink px-3 py-2 text-xs text-panel shadow-lg" style={{ left: `min(calc(${(hover / s.days.length) * 100}% ), calc(100% - 160px))` }}>
                <div className="mb-1 font-semibold">{new Date(s.days[hover].date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
                {SERIES.map((x) => <div key={x.key} className="flex justify-between gap-4"><span>{x.label}</span><span className="tabular-nums">{s.days[hover][x.key]}</span></div>)}
              </div>
            )}
          </div>
          <div className="mt-2 flex gap-1.5 text-[10px] text-ink-3">
            {s.days.map((d, i) => <div key={d.date} className="flex-1 text-center">{i % 2 === 0 ? new Date(d.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }) : ""}</div>)}
          </div>
        </section>
      </div>
    </div>
  );
}
