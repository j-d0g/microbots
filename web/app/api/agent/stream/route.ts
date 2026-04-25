import { NextRequest } from "next/server";
import { mockTimeline } from "@/lib/mock-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseEncode(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** SSE bridge for the Pydantic AI agent.
 *
 *  - If AGENT_BASE_URL is set, this route proxies POST body to
 *    {AGENT_BASE_URL}/agent/stream and forwards SSE frames back.
 *  - Otherwise it emits the deterministic mock timeline from
 *    lib/mock-agent.ts so the UI has something to react to.
 */
export async function POST(req: NextRequest) {
  const base = process.env.AGENT_BASE_URL;
  const mockFlag = process.env.NEXT_PUBLIC_MOCK_AGENT ?? "true";

  if (base && mockFlag !== "true") {
    const upstream = await fetch(`${base}/agent/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await req.text(),
      // @ts-expect-error duplex is required for streaming request bodies but
      // not yet in the TS lib in all runtimes.
      duplex: "half",
    });
    return new Response(upstream.body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const t0 = Date.now();
      for (const step of mockTimeline) {
        const wait = step.at - (Date.now() - t0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        controller.enqueue(enc.encode(sseEncode(step.event)));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
