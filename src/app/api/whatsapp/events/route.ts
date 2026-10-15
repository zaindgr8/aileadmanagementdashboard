import { bus } from "@/lib/whatsapp/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-sent events: the dashboard refreshes live when messages arrive or statuses change.
export async function GET(req: Request) {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      const onChange = (e: unknown) => send(e);
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
