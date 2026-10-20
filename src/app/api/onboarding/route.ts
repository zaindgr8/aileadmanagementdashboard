import { NextResponse } from "next/server";
import { body, fail, requireManager, requireUser, sameOrigin } from "@/lib/tenant/api";
import { getWorkspace, updateWorkspace, type Workspace } from "@/lib/tenant/workspaces";
import { setupSteps } from "@/lib/tenant/onboarding";
import { instagramAppConfigured } from "@/lib/instagram/api";
import type { BusinessInfo } from "@/lib/tenant/types";
import { q, sb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const FIELDS: (keyof BusinessInfo)[] = ["website", "about", "offer", "prices", "customers", "faqs", "goal", "bookingLink", "tone", "languages", "agentName"];

async function view(ws: Workspace) {
  const people = (await sb<{ username: string }[]>(`app_users?workspace_id=eq.${q(ws.id)}&active=eq.true&select=username`)).length;
  const o = ws.onboarding;
  return {
    workspace: { id: ws.id, name: ws.name, modules: ws.modules },
    steps: setupSteps(ws, people),
    business: o.business ?? {},
    docs: (o.docs ?? []).map(({ text: _t, ...d }) => (void _t, d)),
    submittedAt: o.submittedAt ?? null,
    agentLiveAt: o.agentLiveAt ?? null,
    instagram: { appReady: instagramAppConfigured(), username: ws.config.instagram?.username ?? null },
  };
}

export async function GET() {
  const g = await requireUser();
  if ("response" in g) return g.response;
  const ws = await getWorkspace(g.user.workspace);
  if (!ws) return fail("Workspace not found.", 404);
  return NextResponse.json({ ...(await view(ws)), canEdit: g.user.role !== "member" || g.user.platformAdmin });
}

// Save the business details. { submit: true } marks the step done (the team is told the agent can be built).
export async function PUT(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const b = await body<{ business: BusinessInfo; submit: boolean }>(req);
  const business: BusinessInfo = {};
  for (const k of FIELDS) {
    const v = b.business?.[k];
    if (v !== undefined) business[k] = String(v).slice(0, k === "faqs" || k === "prices" || k === "about" || k === "offer" ? 6000 : 500).trim();
  }
  if (business.website && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(business.website)) {
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(business.website)) business.website = `https://${business.website}`;
    else return fail("Website should look like https://yourbusiness.com");
  }
  const ws = await getWorkspace(g.user.workspace);
  if (!ws) return fail("Workspace not found.", 404);
  const merged = { ...ws.onboarding.business, ...business };
  if (b.submit && !(merged.about || merged.website)) return fail("Add your website or a short description first.");
  const updated = await updateWorkspace(ws.id, {
    onboarding: { business: merged, ...(b.submit ? { submittedAt: ws.onboarding.submittedAt ?? new Date().toISOString() } : {}) },
  });
  return NextResponse.json({ ...(await view(updated)), canEdit: true });
}
