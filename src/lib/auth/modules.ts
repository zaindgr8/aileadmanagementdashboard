// The product's modules. A user's access list decides which ones they see.
export const MODULES = ['whatsapp', 'calls'] as const;
export type ModuleKey = (typeof MODULES)[number];

export const MODULE_META: Record<ModuleKey, { label: string; href: string }> = {
  whatsapp: { label: 'WhatsApp', href: '/whatsapp' },
  calls: { label: 'Voice calls', href: '/calls' },
};

export type Role = 'owner' | 'admin' | 'member';

/** What the browser is told about the signed-in user. */
export interface SessionUser {
  username: string;
  name: string;
  role: Role;
  modules: ModuleKey[];
  /** The workspace (client account) they're signed in to. */
  workspace: string;
  workspaceName: string;
  /** Platform admins run the whole product: approve workspaces and open any of them. */
  platformAdmin: boolean;
}

/** Which module a path belongs to, if any. Used by the proxy and route guards. */
export function moduleForPath(pathname: string): ModuleKey | null {
  if (pathname === '/whatsapp' || pathname.startsWith('/whatsapp/') || pathname.startsWith('/api/whatsapp/')) return 'whatsapp';
  if (pathname === '/calls' || pathname.startsWith('/calls/') || pathname.startsWith('/api/voice/')) return 'calls';
  return null;
}
