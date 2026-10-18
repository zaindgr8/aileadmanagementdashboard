import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/current";
import { createAgent, listAgents } from "@/lib/whatsapp/team";
import { usernameTaken } from "@/lib/auth/users";
import type { Agent } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listAgents());
}

// Add a teammate who can sign in and work the WhatsApp inbox. Owners and admins only.
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me || (me.role !== "owner" && me.role !== "admin")) return NextResponse.json({ error: "Only owners and admins can add teammates." }, { status: 403 });
  const b = (await req.json()) as { username?: string; name?: string; password?: string; role?: Agent["role"]; calls?: boolean };
  const username = String(b.username ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return NextResponse.json({ error: "Username: 3–32 characters, letters, numbers, dot, dash or underscore." }, { status: 400 });
  if (String(b.password ?? "").length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  const role: Agent["role"] = b.role === "admin" && me.role === "owner" ? "admin" : "member";
  if (await usernameTaken(username)) return NextResponse.json({ error: "That username is taken." }, { status: 409 });
  try {
    await createAgent({ username, name: String(b.name ?? "").trim() || username, password: String(b.password), role, modules: b.calls ? ["whatsapp", "calls"] : ["whatsapp"] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: /duplicate|unique/i.test(msg) ? "That username is taken." : "Couldn't add the teammate." }, { status: 400 });
  }
  return NextResponse.json(await listAgents());
}
