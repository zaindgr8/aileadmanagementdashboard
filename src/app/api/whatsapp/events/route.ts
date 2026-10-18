import { bus } from "@/lib/whatsapp/store";
import { currentUser } from "@/lib/auth/current";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-sent events: the dashboard refreshes live when messages arrive or statuses change.
// Each browser only hears about its own workspace.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Please sign in", { status: 401 });
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      const onChange = (e: { workspace?: string }) => {
        if (e.workspace === user.workspace) send(e);
      };
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 25_000);
      bus.on("change", onChange);
      send({ type: "hello" });
      cleanup = () => {
        clearInterval(ping);
        bus.off("change", onChange);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch {}
      });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
