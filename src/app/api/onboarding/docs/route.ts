import { NextResponse } from "next/server";
import { fail, requireManager, sameOrigin } from "@/lib/tenant/api";
import { getWorkspace, updateWorkspace } from "@/lib/tenant/workspaces";
import { geminiConfigured, geminiReadFile } from "@/lib/ai/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DOCS = 8;
const TYPES: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", md: "text/plain", csv: "text/csv", html: "text/html",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

// Upload a price list, menu, brochure or FAQ. Gemini turns it into plain text for the agent's knowledge;
// only that text is kept (not the file).
export async function POST(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const ws = await getWorkspace(g.user.workspace);
  if (!ws) return fail("Workspace not found.", 404);
  if ((ws.onboarding.docs ?? []).length >= MAX_DOCS) return fail(`Up to ${MAX_DOCS} documents. Remove one first.`);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Choose a file to upload.");
  if (file.size > MAX_BYTES) return fail("Files up to 8 MB, please.");
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = TYPES[ext];
  if (!mime) return fail("Upload a PDF, text file or image (PNG/JPG). For Word files, save as PDF first.");

  let text: string;
  const buf = Buffer.from(await file.arrayBuffer());
  if (mime.startsWith("text/")) text = buf.toString("utf8");
  else {
    if (!geminiConfigured) return fail("Reading PDFs and images needs GEMINI_API_KEY.", 503);
    try {
      text = await geminiReadFile({
        data: buf.toString("base64"), mimeType: mime,
        prompt: "Extract all the useful business information from this document as clean plain text: products or services, prices, packages, policies, opening hours, locations, FAQs and contact details. Keep numbers and names exactly. No commentary.",
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Couldn't read that file.", 502);
    }
  }
  text = text.replace(/\u0000/g, "").trim().slice(0, 30_000);
  if (!text) return fail("That file had no readable text.");

  const doc = { id: crypto.randomUUID(), name: file.name.slice(0, 120), chars: text.length, addedAt: new Date().toISOString(), text };
  await updateWorkspace(ws.id, { onboarding: { docs: [...(ws.onboarding.docs ?? []), doc] } });
  return NextResponse.json({ id: doc.id, name: doc.name, chars: doc.chars, addedAt: doc.addedAt });
}

export async function DELETE(req: Request) {
  const g = await requireManager();
  if ("response" in g) return g.response;
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  const id = new URL(req.url).searchParams.get("id");
  const ws = await getWorkspace(g.user.workspace);
  if (!ws || !id) return fail("Not found.", 404);
  await updateWorkspace(ws.id, { onboarding: { docs: (ws.onboarding.docs ?? []).filter((d) => d.id !== id) } });
  return NextResponse.json({ ok: true });
}
