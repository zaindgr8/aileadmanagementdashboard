import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/current";
import { addNote, listNotes } from "@/lib/whatsapp/team";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Internal notes inside a chat. Never sent to the customer.
export async function GET(_: Request, { params }: Ctx) {
  return NextResponse.json(await listNotes(decodeURIComponent((await params).id)));
}

export async function POST(req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { body } = (await req.json()) as { body?: string };
  const text = String(body ?? "").trim().slice(0, 4000);
  if (!text) return NextResponse.json({ error: "Write a note first." }, { status: 400 });
  return NextResponse.json(await addNote({ conversationId: decodeURIComponent((await params).id), author: me.username, authorName: me.name, body: text }));
}
