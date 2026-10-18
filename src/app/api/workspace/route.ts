import { NextResponse } from "next/server";
import { body, fail, originOf, requireManager, requireUser, sameOrigin } from "@/lib/tenant/api";
import { listInvites } from "@/lib/tenant/invites";
import { credentialSources, getWorkspace, publicInfo, updateWorkspace, type WorkspacePatch } from "@/lib/tenant/workspaces";
import { q, sb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Everything the Workspace settings page shows. Secrets are never sent, only whether they're saved. */
async function view(req: Request, id: string, manager: boolean) {
  const ws = await getWorkspace(id);
  if (!ws) return null;
  const base = originOf(req);
  const users = await sb<{ username: string; display_name: string; email: string | null; role: string; modules: string[]; active: boolean; last_login_at: string | null }[]>(
    `app_users?workspace_id=eq.${q(id)}&select=username,display_name,email,role,modules,active,last_login_at&order=created_at.asc`,
  );
  return {
    workspace: publicInfo(ws),
    sources: credentialSources(ws),
    webhooks: {
      inbound: `${base}/api/webhooks/twilio?ws=${encodeURIComponent(ws.id)}`,
      status: `${base}/api/webhooks/twilio/status?ws=${encodeURIComponent(ws.id)}`,
      publicBaseUrlSet: Boolean(process.env.PUBLIC_BASE_URL),
    },
    users,
    invites: manager ? await listInvites(id) : [],
  };
}

export async function GET(req: Request) {
  const g = await requireUser();
  if ("response" in g) return g.response;
  const manager = g.user.role === "owner" || g.user.role === "admin" || g.user.platformAdmin;
  const v = await view(req, g.user.workspace, manager);
  return v ? NextResponse.json({ ...v, canManage: manager }) : fail("Workspace not found.", 404);
}

const SID = /^AC[0-9a-fA-F]{32}$/;
const MG = /^MG[0-9a-fA-F]{32}$/;
const PHONE = /^(whatsapp:)?\+[1-9]\d{6,14}$/;

// Rename the workspace or save its connections (Twilio / Retell). Owners and admins only.
export async function PATCH(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const b = await body<{
    name: string;
    twilioAccountSid: string; twilioAuthToken: string; twilioFrom: string; twilioMessagingServiceSid: string;
    retellApiKey: string; retellAgentIds: string[] | string;
  }>(req);

  const patch: WorkspacePatch = {};
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (name.length < 2) return fail("Name is too short.");
    patch.name = name;
  }
  const config: NonNullable<WorkspacePatch["config"]> = {};
  const secrets: NonNullable<WorkspacePatch["secrets"]> = {};
  const trim = (v: unknown) => String(v ?? "").trim();
  if (b.twilioAccountSid !== undefined) {
    const v = trim(b.twilioAccountSid);
    if (v && !SID.test(v)) return fail("Twilio Account SID starts with AC and is 34 characters.");
    config.twilioAccountSid = v || undefined;
  }
  if (b.twilioFrom !== undefined) {
    const v = trim(b.twilioFrom).replace(/\s+/g, "");
    if (v && !PHONE.test(v)) return fail("WhatsApp sender must be a number like +14155238886.");
    config.twilioFrom = v ? (v.startsWith("whatsapp:") ? v : `whatsapp:${v}`) : undefined;
  }
  if (b.twilioMessagingServiceSid !== undefined) {
    const v = trim(b.twilioMessagingServiceSid);
    if (v && !MG.test(v)) return fail("Messaging Service SID starts with MG and is 34 characters.");
    config.twilioMessagingServiceSid = v || undefined;
  }
  if (b.retellAgentIds !== undefined) {
    const list = (Array.isArray(b.retellAgentIds) ? b.retellAgentIds : String(b.retellAgentIds).split(/[\s,]+/)).map((s) => s.trim()).filter(Boolean);
    if (list.some((id) => !/^agent_[A-Za-z0-9]+$/.test(id))) return fail("Retell agent IDs look like agent_abc123…");
    config.retellAgentIds = list;
  }
  // Secrets: "" removes, a value replaces, left out keeps what's saved.
  if (b.twilioAuthToken !== undefined) {
    const v = trim(b.twilioAuthToken);
    if (v && !/^[0-9a-fA-F]{32}$/.test(v)) return fail("Twilio auth token is 32 letters and numbers.");
    secrets.twilioAuthToken = v;
  }
  if (b.retellApiKey !== undefined) {
    const v = trim(b.retellApiKey);
    if (v && v.length < 20) return fail("That Retell API key looks too short.");
    secrets.retellApiKey = v;
  }
  if (Object.keys(config).length) patch.config = config;
  if (Object.keys(secrets).length) patch.secrets = secrets;

  await updateWorkspace(g.user.workspace, patch);
  const v = await view(req, g.user.workspace, true);
  return NextResponse.json({ ...v, canManage: true });
}
