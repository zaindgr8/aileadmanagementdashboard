import "server-only";
import { countConversations, ensureConversation, updateConversation, upsertMessage, logAgentEvent } from "./store";
import { twilioConfigured } from "./twilio";
import type { Author, Lead } from "./types";

/** Fill an empty dashboard with sample chats so you can explore it before connecting Twilio. */
export async function seedDemoIfEmpty() {
  if (twilioConfigured || process.env.DISABLE_DEMO === "true") return;
  if (await countConversations()) return;

  const now = Date.now();
  const min = 60_000;
  type Seed = { phone: string; name: string; ai: boolean; needsHuman?: boolean; reason?: string; resolved?: boolean; lead: Partial<Lead>; msgs: [Author, string, number][] };
  const chats: Seed[] = [
    {
      phone: "+971501234567", name: "Omar Haddad", ai: true,
      lead: { stage: "hot", score: 88, intent: "Book a call", interest: "AI WhatsApp automation", budget: "AED 15,000", company: "Haddad Realty", email: "omar@haddadrealty.ae", summary: "Real-estate broker wants an AI agent to qualify property leads on WhatsApp.", nextStep: "Confirm Thursday 3pm call and send proposal" },
      msgs: [
        ["customer", "Hi, I saw your AI automation work. We get 200+ property inquiries a week on WhatsApp.", 46],
        ["ai", "Hi Omar! That's exactly what we automate — an AI agent that answers, qualifies and books viewings 24/7. What's your current setup?", 45],
        ["customer", "Two agents answering manually. Budget is around AED 15k. Can we talk this week?", 9],
        ["ai", "Absolutely. Would Thursday at 3pm Dubai time work for a 20-minute call?", 8],
        ["customer", "Thursday works. omar@haddadrealty.ae", 2],
      ],
    },
    {
      phone: "+447700900456", name: "James Patel", ai: false, needsHuman: true, reason: "Asked for a custom enterprise quote — needs a human.",
      lead: { stage: "qualified", score: 64, intent: "Enterprise quote", interest: "CRM + website rebuild", company: "Patel Logistics", summary: "Logistics company wants a CRM integration and new website; asked for a custom quote.", nextStep: "Send enterprise pricing and case studies" },
      msgs: [
        ["customer", "We need a new website plus CRM integration for 3 branches.", 32],
        ["ai", "Great — we've built multi-branch setups before. Which CRM do you use today?", 31],
        ["customer", "HubSpot. Can someone send me a proper quote? I'd rather speak to a person.", 18],
        ["ai", "Of course! I'm connecting you with a member of our team — they'll reply here shortly.", 17],
      ],
    },
    {
      phone: "+923001234567", name: "Ayesha Khan", ai: true,
      lead: { stage: "new", score: 28, intent: "Pricing inquiry", interest: "SEO", summary: "Small boutique owner curious about SEO pricing; no budget or timeline yet.", nextStep: "Share starter SEO package" },
      msgs: [
        ["customer", "Assalam o alaikum, do you do SEO for small shops?", 190],
        ["ai", "Wa alaikum assalam! Yes — we have starter SEO plans for small businesses. What kind of shop do you run?", 189],
        ["customer", "Clothing boutique in Lahore", 185],
      ],
    },
    {
      phone: "+14155550123", name: "Sarah Johnson", ai: true,
      lead: { stage: "won", score: 95, intent: "Signed", interest: "Shopify store", budget: "$4,500", email: "sarah@bloomco.com", company: "Bloom & Co", summary: "Signed for a Shopify build; onboarding scheduled.", nextStep: "Kick-off call Monday" },
      msgs: [
        ["customer", "Contract signed ✅ When do we start?", 1500],
        ["agent", "Welcome aboard Sarah! Kick-off is Monday 10am — invite on its way.", 1490],
      ],
    },
    {
      phone: "+966551234567", name: "", ai: true,
      lead: { stage: "lost", score: 12, intent: "Job seeker", summary: "Looking for a job, not a customer.", nextStep: "No action" },
      msgs: [
        ["customer", "مرحبا، هل لديكم وظائف شاغرة؟", 3000],
        ["ai", "مرحباً! يمكنك إرسال سيرتك الذاتية إلى careers@ — سنتواصل معك إن توفرت فرصة.", 2999],
      ],
    },
  ];

  for (const c of chats) {
    const id = `whatsapp:${c.phone}`;
    await ensureConversation(id, c.name);
    for (const [i, [author, body, agoMin]] of c.msgs.entries()) {
      await upsertMessage(
        {
          id: `demo_${c.phone}_${i}`,
          conversationId: id,
          direction: author === "customer" ? "inbound" : "outbound",
          author,
          body,
          media: [],
          status: author === "customer" ? "received" : "read",
          createdAt: new Date(now - agoMin * min).toISOString(),
        },
        { countUnread: author === "customer" && agoMin < 20 },
      );
      if (author === "ai") await logAgentEvent({ conversationId: id, type: "reply", detail: body, model: "claude-opus-5-5", latencyMs: 1400 + i * 120, inputTokens: 900, outputTokens: 60 });
    }
    await updateConversation(id, {
      aiEnabled: c.ai, needsHuman: !!c.needsHuman, handoffReason: c.reason,
      status: c.lead.stage === "won" || c.lead.stage === "lost" ? "resolved" : "open",
      lead: { stage: "new", score: 0, intent: "", summary: "", interest: "", budget: "", email: "", company: "", nextStep: "", ...c.lead, source: "ai", analyzedAt: new Date().toISOString() },
    });
  }
}
