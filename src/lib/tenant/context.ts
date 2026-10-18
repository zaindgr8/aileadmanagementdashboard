import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Which workspace (client account) the current piece of work belongs to.
// Requests from the dashboard get it from the session cookie; webhooks, timers and the poller
// set it explicitly with inWorkspace(), and Node carries it through awaits and timers from there.
const als = new AsyncLocalStorage<string>();

export class WorkspaceError extends Error {
  constructor(message: string, readonly status = 401) { super(message); }
}

export function inWorkspace<T>(workspaceId: string, fn: () => T): T {
  return als.run(workspaceId, fn);
}

/** The current workspace id. Throws when there is none (signed out, or background work that forgot to set it). */
export async function workspaceId(): Promise<string> {
  const id = als.getStore();
  if (id) return id;
  try {
    const { currentUser } = await import("../auth/current");
    const user = await currentUser();
    if (user?.workspace) return user.workspace;
  } catch {
    // cookies() is unavailable outside a request.
  }
  throw new WorkspaceError("No workspace for this request. Please sign in again.");
}

/** Run `fn` later (timers, fire-and-forget work) in the workspace that is current now. */
export async function bindWorkspace(): Promise<<T>(fn: () => T) => T> {
  const id = await workspaceId();
  return (fn) => inWorkspace(id, fn);
}

/** PostgREST filter for the current workspace, e.g. `conversations?${await wsFilter()}&…`. */
export async function wsFilter() {
  return `workspace_id=eq.${encodeURIComponent(await workspaceId())}`;
}
