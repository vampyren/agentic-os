// GET /api/events — Server-Sent Events feed of every BusEvent the kernel
// emits. One subscription per browser tab. Per ADR-0003, this is the single
// real-time channel; there is no polling.

import { bus } from "@/kernel/bus";
import type { BusEvent } from "@/kernel/types";
import { originOk, forbidden } from "../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!originOk(req)) return forbidden();

  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (line: string) => {
        try { controller.enqueue(enc.encode(line)); } catch { /* closed */ }
      };

      // Initial comment + hello so the browser knows the stream is live.
      send(`: agentic-os event stream\n\n`);
      send(`event: hello\ndata: {"ts":${Date.now()}}\n\n`);

      const unsubscribe = bus.on((evt: BusEvent) => {
        send(`data: ${JSON.stringify(evt)}\n\n`);
      });

      // Keepalive comment every 25s to defeat proxy idle timeouts in case
      // we're ever fronted by one. Cleared on abort.
      const ping = setInterval(() => send(`: ping\n\n`), 25_000);

      const cleanup = () => {
        clearInterval(ping);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() { /* covered by abort handler above */ },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "Connection": "keep-alive",
    },
  });
}
