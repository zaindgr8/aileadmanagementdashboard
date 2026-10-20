import "server-only";
import { randomInt } from "node:crypto";
import { currentWorkspace, getWorkspace, listWorkspaces, updateWorkspace, type Workspace } from "../tenant/workspaces";
import type { WhatsAppCloudAccount } from "../tenant/types";
import { discoverAssets, exchangeCode, getPhone, getWaba, registerPhone, subscribeApp, unsubscribeApp } from "./api";

export interface CloudCtx { workspace: Workspace; account: WhatsAppCloudAccount; token: string }

/** The current workspace's WhatsApp Cloud connection, or null. */
export async function cloudFor(ws?: Workspace): Promise<CloudCtx | null> {
  const w = ws ?? (await currentWorkspace());
  const token = w.secrets.whatsappCloudToken;
  return token && w.config.whatsappCloud ? { workspace: w, account: w.config.whatsappCloud, token } : null;
}

/** Which workspace a webhook is for, by the phone number id Meta sends. */
export async function workspaceForPhoneNumberId(phoneNumberId: string): Promise<Workspace | null> {
  const all = await listWorkspaces();
  return all.find((w) => w.status === "active" && w.config.whatsappCloud?.phoneNumberId === phoneNumberId) ?? null;
}

/**
 * Finish Embedded Signup: code → token, then make the number ready to use (webhook subscription and
 * Cloud API registration) and save it to the workspace.
 */
export async function connectFromSignup(workspaceId: string, input: { code: string; wabaId?: string; phoneNumberId?: string }, by: string) {
  const { token } = await exchangeCode(input.code);
  let wabaId = input.wabaId ?? "";
  let phoneNumberId = input.phoneNumberId ?? "";
  if (!wabaId || !phoneNumberId) {
    const found = await discoverAssets(token);
    if (!found) throw new Error("Couldn't find the WhatsApp account you picked. Please try again and finish all steps in the pop-up.");
    ({ wabaId, phoneNumberId } = found);
  }
  await getWaba(token, wabaId); // proves the token can manage this account

  const clash = (await listWorkspaces()).find((w) => w.id !== workspaceId && w.config.whatsappCloud?.phoneNumberId === phoneNumberId);
  if (clash) throw new Error("This WhatsApp number is already connected to another workspace. Disconnect it there first.");

  const current = await getWorkspace(workspaceId);
  const pin = current?.secrets.whatsappCloudPin || String(randomInt(100000, 999999));
  await subscribeApp(token, wabaId);
  await registerPhone(token, phoneNumberId, pin);
  const phone = await getPhone(token, phoneNumberId);

  await updateWorkspace(workspaceId, {
    config: {
      whatsappCloud: {
        wabaId, phoneNumberId, displayPhone: phone.displayPhone, verifiedName: phone.verifiedName,
        connectedAt: new Date().toISOString(), connectedBy: by,
      },
    },
    secrets: { whatsappCloudToken: token, whatsappCloudPin: pin },
  });
  return phone;
}

export async function disconnectCloud(workspaceId: string) {
  const ws = await getWorkspace(workspaceId);
  const acc = ws?.config.whatsappCloud;
  if (acc && ws?.secrets.whatsappCloudToken) await unsubscribeApp(ws.secrets.whatsappCloudToken, acc.wabaId);
  await updateWorkspace(workspaceId, { config: { whatsappCloud: undefined }, secrets: { whatsappCloudToken: "" } });
}
