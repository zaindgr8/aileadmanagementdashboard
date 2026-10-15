import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/current';
import { listConversations } from '@/lib/whatsapp/store';
import { listWaLeads } from '@/lib/whatsapp/waLeads';
import { summarize } from '@/lib/voice/calls';
import { buildLeads, byPriority } from '@/lib/voice/leads';
import { leadCalls, readLeads } from '@/lib/voice/server/leads';
import type { Contact, Overview } from '@/lib/overview';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Failed to load');
const digits = (p: string) => p.replace(/[^\d+]/g, '');

// One read across both modules: headline numbers per channel, plus every contact
// merged by phone number so you can see who you've reached on WhatsApp, by phone, or both.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
  const hasWa = user.modules.includes('whatsapp');
  const hasCalls = user.modules.includes('calls');
  const contacts = new Map<string, Contact>();
  const contact = (phone: string) => {
    const key = digits(phone);
    let c = contacts.get(key);
    if (!c) contacts.set(key, (c = { phone: key, name: '', channels: [], score: null, lastTouch: 0 }));
    return c;
  };
  const out: Overview = { whatsapp: null, calls: null, contacts: [], attention: [] };

  const wa = hasWa ? (async () => {
    try {
      const [convs, profiles] = await Promise.all([listConversations(), listWaLeads().catch(() => [])]);
      const stages = { new: 0, qualified: 0, hot: 0, won: 0, lost: 0 };
      let scoreSum = 0, scored = 0;
      for (const c of convs) {
        if (c.lead) { stages[c.lead.stage]++; scoreSum += c.lead.score; scored++; }
        const k = contact(c.phone);
        k.name ||= c.name || c.profileName;
        k.channels.push('whatsapp');
        k.waId = c.id;
        k.waStage = c.lead?.stage;
        k.score = Math.max(k.score ?? 0, c.lead?.score ?? 0);
        k.lastTouch = Math.max(k.lastTouch, new Date(c.lastMessageAt).getTime());
        if (c.lead?.summary) k.summary ||= c.lead.summary;
        if (c.needsHuman) out.attention.push({ kind: 'whatsapp', phone: k.phone, name: k.name || c.phone, text: c.handoffReason || 'Needs a human reply', href: `/whatsapp?c=${encodeURIComponent(c.id)}` });
      }
      for (const p of profiles) {
        const k = contact(p.phone);
        k.name ||= p.name || p.wa_name;
        if (!k.channels.includes('whatsapp')) k.channels.push('whatsapp');
        k.waProfileStage = p.stage;
      }
      const week = Date.now() - 7 * DAY;
      out.whatsapp = {
        conversations: convs.length,
        open: convs.filter((c) => c.status === 'open').length,
        unread: convs.reduce((s, c) => s + c.unread, 0),
        needsHuman: convs.filter((c) => c.needsHuman).length,
        activeWeek: convs.filter((c) => new Date(c.lastMessageAt).getTime() >= week).length,
        aiActive: convs.filter((c) => c.aiEnabled).length,
        stages,
        avgScore: scored ? Math.round(scoreSum / scored) : null,
        profiles: profiles.length,
      };
    } catch (e) {
      out.whatsapp = { error: msg(e) };
    }
  })() : null;

  const calls = hasCalls ? (async () => {
    try {
      const [records, history] = await Promise.all([readLeads(), leadCalls()]);
      const now = Date.now();
      const leads = buildLeads(records, history, now).filter((l) => !l.archived).sort(byPriority);
      const recent = history.filter((c) => (c.start ?? 0) >= now - 30 * DAY);
      const s = summarize(recent);
      for (const l of leads) {
        const k = contact(l.phone);
        k.name ||= l.name;
        k.channels.push('calls');
        k.callStage = l.stage;
        k.score = Math.max(k.score ?? 0, l.score);
        k.lastTouch = Math.max(k.lastTouch, l.last_contact ?? l.created_at);
        if (l.last_summary) k.summary ||= l.last_summary;
        k.nextAction = l.next_action.text;
      }
      for (const l of leads.filter((x) => x.next_action.urgency === 'high').slice(0, 8)) {
        out.attention.push({ kind: 'calls', phone: l.phone, name: l.name || l.phone, text: l.next_action.text, href: `/calls/leads?lead=${encodeURIComponent(l.phone)}` });
      }
      out.calls = {
        calls30d: s.total,
        answered30d: s.answered,
        answerRate: Number.isFinite(s.answerRate) ? s.answerRate : null,
        talkMs: s.talk,
        costCents: s.cost,
        live: s.live,
        leads: leads.length,
        hot: leads.filter((l) => l.temperature === 'hot' && l.stage !== 'won' && l.stage !== 'lost').length,
        followUpsDue: leads.filter((l) => l.follow_up_at && l.follow_up_at <= now && l.stage !== 'won' && l.stage !== 'lost').length,
        won: leads.filter((l) => l.stage === 'won').length,
      };
    } catch (e) {
      out.calls = { error: msg(e) };
    }
  })() : null;

  await Promise.all([wa, calls]);
  out.contacts = [...contacts.values()].sort((a, b) => b.lastTouch - a.lastTouch).slice(0, 500);
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
