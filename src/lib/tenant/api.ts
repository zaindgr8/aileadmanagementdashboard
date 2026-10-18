import "server-only";
import { NextResponse } from "next/server";
import { currentUser } from "../auth/current";
import type { SessionUser } from "../auth/modules";
import { publicBaseUrl } from "./workspaces";

// Small helpers for the workspace / admin route handlers.
export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

type Guard = { user: SessionUser } | { response: NextResponse };

export async function requireUser(): Promise<Guard> {
  const user = await currentUser();
  return user ? { user } : { response: fail("Please sign in", 401) };
}

/** Owners and admins of the current workspace (and platform admins). */
export async function requireManager(): Promise<Guard> {
  const g = await requireUser();
  if ("response" in g) return g;
  const { user } = g;
  if (user.role === "owner" || user.role === "admin" || user.platformAdmin) return g;
  return { response: fail("Only workspace owners and admins can do this.", 403) };
}

export async function requirePlatformAdmin(): Promise<Guard> {
  const g = await requireUser();
  if ("response" in g) return g;
  return g.user.platformAdmin ? g : { response: fail("Platform admins only.", 403) };
}

/** The app's public address, for invite links and webhook URLs. */
export function originOf(req: Request) {
  const base = publicBaseUrl();
  if (base) return base;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")).split(",")[0].trim();
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export async function body<T>(req: Request): Promise<Partial<T>> {
  return ((await req.json().catch(() => ({}))) ?? {}) as Partial<T>;
}

/** Cross-site POSTs are refused (cookies are SameSite=Lax, this is belt and braces). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}
