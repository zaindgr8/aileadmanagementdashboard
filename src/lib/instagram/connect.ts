import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { currentWorkspace, getWorkspace, listWorkspaces, updateWorkspace, type Workspace } from "../tenant/workspaces";
import type { InstagramAccount } from "../tenant/types";
import { getMe, refreshToken, subscribeWebhooks, unsubscribeWebhooks, type IgProfile } from "./api";

// ---------- OAuth state: which workspace the login is for, signed so it can't be forged ----------
const secret = () => process.env.SESSION_SECRET || "";
const sign = (v: string) => createHmac("sha256", secret()).update(`ig-state:${v}`).digest("base64url");

export function makeState(workspace: string, username: string) {
  const body = Buffer.from(JSON.stringify({ w: workspace, u: username, exp: Date.now() + 15 * 60_000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readState(state: string | null): { w: string; u: string } | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { w: string; u: string; exp: number };
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

// ---------- the connected account ----------
export interface IgCtx { workspace: Workspace; account: InstagramAccount; token: string }

const DAY = 86_400_000;

/** Refresh the token when it has under 10 days left (Meta allows it once it's a day old). */
async function freshToken(ws: Workspace): Promise<string | null> {
  const acc = ws.config.instagram;
  const token = ws.secrets.instagramToken;
  if (!acc || !token) return null;
  const left = acc.tokenExpiresAt ? new Date(acc.tokenExpiresAt).getTime() - Date.now() : Infinity;
  const age = Date.now() - new Date(acc.connectedAt).getTime();
  if (left < 10 * DAY && age > DAY) {
    try {
      const r = await refreshToken(token);
      await updateWorkspace(ws.id, { config: { instagram: { ...acc, tokenExpiresAt: r.expiresAt } }, secrets: { instagramToken: r.token } });
      return r.token;
    } catch (err) {
      console.error(`[instagram:${ws.id}] token refresh failed:`, err instanceof Error ? err.message : err);
    }
  }
  return token;
}

export async function instagramFor(ws?: Workspace): Promise<IgCtx | null> {
  const w = ws ?? (await currentWorkspace());
  const token = await freshToken(w);
  if (!token || !w.config.instagram) return null;
  return { workspace: w, account: w.config.instagram, token };
}

/** Which workspace an incoming webhook is for, by the Instagram account id Meta sends. */
export async function workspaceForInstagram(igUserId: string): Promise<Workspace | null> {
  const all = await listWorkspaces();
  return all.find((w) => w.status === "active" && w.config.instagram?.userId === igUserId) ?? null;
}

/** Save a freshly connected account to the workspace and turn its webhooks on. */
export async function saveConnection(workspaceId: string, token: string, expiresAt: string, by: string): Promise<IgProfile> {
  const me = await getMe(token);
  // One Instagram account belongs to one workspace, or messages would land in two inboxes.
  const clash = (await listWorkspaces()).find((w) => w.id !== workspaceId && w.config.instagram?.userId === me.userId);
  if (clash) throw new Error(`@${me.username} is already connected to another workspace. Disconnect it there first.`);
  await subscribeWebhooks(token);
  await updateWorkspace(workspaceId, {
    config: {
      instagram: {
        userId: me.userId, username: me.username, name: me.name, picture: me.picture,
        connectedAt: new Date().toISOString(), connectedBy: by, tokenExpiresAt: expiresAt,
      },
    },
    secrets: { instagramToken: token },
  });
  return me;
}

export async function disconnect(workspaceId: string) {
  const ws = await getWorkspace(workspaceId);
  if (ws?.secrets.instagramToken) await unsubscribeWebhooks(ws.secrets.instagramToken);
  await updateWorkspace(workspaceId, { config: { instagram: undefined }, secrets: { instagramToken: "" } });
}

/** Keep every workspace's token alive (called by the background poller). */
export async function refreshAllTokens() {
  for (const w of await listWorkspaces().catch(() => [])) {
    if (w.config.instagram) await freshToken(w).catch(() => null);
  }
}
