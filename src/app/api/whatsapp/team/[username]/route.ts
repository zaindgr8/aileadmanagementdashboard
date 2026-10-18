import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/current";
import { listAgents, updateAgent } from "@/lib/whatsapp/team";
import type { Agent } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ username: string }> };

// Agents can set their own availability; owners/admins can change anyone (except an owner's role or access).
export async function PATCH(req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const username = decodeURIComponent((await params).username);
  const b = (await req.json()) as { available?: boolean; active?: boolean; role?: Agent["role"]; name?: string; password?: string };
  const manager = me.role === "owner" || me.role === "admin";
  const self = me.username === username;
  const target = (await listAgents()).find((a) => a.username === username);
  if (!target) return NextResponse.json({ error: "Teammate not found." }, { status: 404 });
  if (!manager && (!self || Object.keys(b).some((k) => k !== "available"))) return NextResponse.json({ error: "You can only change your own availability." }, { status: 403 });
  if (target.role === "owner" && !self && (b.active !== undefined || b.role)) return NextResponse.json({ error: "The owner's access can't be changed." }, { status: 403 });
  if (self && b.active === false) return NextResponse.json({ error: "You can't deactivate yourself." }, { status: 400 });
  if (b.role && (b.role === "owner" || (b.role === "admin" && me.role !== "owner"))) return NextResponse.json({ error: "Only the owner can make admins." }, { status: 403 });
  if (b.password !== undefined && b.password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  await updateAgent(username, b);
  return NextResponse.json(await listAgents());
}
