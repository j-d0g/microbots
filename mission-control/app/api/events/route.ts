import { ensureBooted } from "@/lib/server/boot";
import { subscribe } from "@/lib/server/bus";
import { snapshot } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  ensureBooted();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // The stream may already have been cancelled by the client.
        }
      };
      cleanup = close;
      const send = (value: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        } catch {
          close();
        }
      };
      send({ type: "snapshot", snapshot: snapshot() });
      unsubscribe = subscribe((event) => send(event));
      heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            close();
          }
        }
      }, 15_000);
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) close();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
