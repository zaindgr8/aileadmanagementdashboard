// Workspace shapes shared by the server and the browser (no secrets in here).
import type { ModuleKey, Role } from "../auth/modules";

export type WorkspaceStatus = "pending" | "active" | "suspended";
export const PLANS = ["starter", "growth", "scale"] as const;

/** Non-secret connection settings. */
export interface WorkspaceConfig {
  twilioAccountSid?: string;
  twilioFrom?: string;
  twilioMessagingServiceSid?: string;
  retellAgentIds?: string[];
}

/** Stored encrypted. */
export interface WorkspaceSecrets {
  twilioAuthToken?: string;
  retellApiKey?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  status: WorkspaceStatus;
  plan: string;
  modules: ModuleKey[];
  isPrimary: boolean;
  contactName: string;
  contactEmail: string;
  config: WorkspaceConfig;
  /** Which secrets are saved, without their values. */
  secretsSet: Record<keyof WorkspaceSecrets, boolean>;
  notes: string;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

/** A row in the admin console. */
export interface WorkspaceSummary extends WorkspaceInfo {
  users: number;
  conversations: number;
  lastActivityAt?: string;
  connected: { whatsapp: boolean; calls: boolean };
}

export interface Invite {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  role: Role;
  modules: ModuleKey[];
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}
