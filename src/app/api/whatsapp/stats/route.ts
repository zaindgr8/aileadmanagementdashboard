import { NextResponse } from "next/server";
import { allMessages, listAgentEvents, listConversations } from "@/lib/whatsapp/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const [messages, convs, events] = await Promise.all([allMessages(), listConversations(), listAgentEvents(1000)]);
  const DAY = 86_400_000;
  const since = Date.now() - 14 * DAY;

  const days: { date: string; inbound: number; ai: number; agent: number }[] = [];
  for (let i = 13; i >= 0; i--) days.push({ date: new Date(Date.now() - i * DAY).toISOString().slice(0, 10), inbound: 0, ai: 0, agent: 0 });
  const byDate = new Map(days.map((d) => [d.date, d]));

  let inbound = 0, ai = 0, agent = 0, failed = 0;
  for (const m of messages) {
    if (m.direction === "inbound") inbound++;
    if (m.author === "ai") ai++;
    if (m.author === "agent") agent++;
    if (m.status === "failed" || m.status === "undelivered") failed++;
    if (new Date(m.createdAt).getTime() >= since) {
      const d = byDate.get(m.createdAt.slice(0, 10));
      if (d) {
        if (m.direction === "inbound") d.inbound++;
        else if (m.author === "ai") d.ai++;
        else if (m.author === "agent") d.agent++;
      }
    }
  }

  // First-response time: customer message → next outbound reply in the same chat.
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const waiting = new Map<string, number>();
  const responseTimes: number[] = [];
  for (const m of sorted) {
    const t = new Date(m.createdAt).getTime();
    if (m.direction === "inbound") { if (!waiting.has(m.conversationId)) waiting.set(m.conversationId, t); }
    else if (waiting.has(m.conversationId)) { responseTimes.push(t - waiting.get(m.conversationId)!); waiting.delete(m.conversationId); }
  }
  responseTimes.sort((a, b) => a - b);

  const replies = events.filter((e) => e.type === "reply");
  const latency = replies.filter((e) => e.latencyMs).map((e) => e.latencyMs!);

  // Lead funnel
  const stages = { new: 0, qualified: 0, hot: 0, won: 0, lost: 0 };
  let scored = 0, scoreSum = 0;
  for (const c of convs) {
    if (!c.lead) continue;
    stages[c.lead.stage]++;
    scored++;
    scoreSum += c.lead.score;
  }
  const closed = stages.won + stages.lost;

  return NextResponse.json({
    leads: {
      stages,
      avgScore: scored ? Math.round(scoreSum / scored) : null,
      winRate: closed ? Math.round((stages.won / closed) * 100) : null,
      pipeline: stages.new + stages.qualified + stages.hot,
    },
    totals: {
      conversations: convs.length,
      open: convs.filter((c) => c.status === "open").length,
      needsHuman: convs.filter((c) => c.needsHuman).length,
      aiActive: convs.filter((c) => c.aiEnabled).length,
      inbound, ai, agent, failed,
      automationRate: ai + agent ? Math.round((ai / (ai + agent)) * 100) : 0,
      medianResponseMs: responseTimes.length ? responseTimes[Math.floor(responseTimes.length / 2)] : null,
      avgAiLatencyMs: latency.length ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length) : null,
      handoffs: events.filter((e) => e.type === "handoff").length,
      errors: events.filter((e) => e.type === "error").length,
      tokens: replies.reduce((s, e) => s + (e.inputTokens ?? 0) + (e.outputTokens ?? 0), 0),
    },
    days,
  });
}
