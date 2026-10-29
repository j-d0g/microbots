import { NextRequest } from "next/server";
import type { AgentEvent } from "@/lib/agent-client";
import type { CanvasSnapshot } from "@/lib/agent/types";
import { activeModelSlug, prewarmConnection } from "@/lib/agent/providers/openrouter";
import { runOrchestrator } from "@/lib/agent/orchestrator";
import { createToolCtx } from "@/lib/agent/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  query?: string;
  snapshot?: CanvasSnapshot;
  userId?: string | null;
}

export async function POST(req: NextRequest) {
  prewarmConnection();

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "bad json body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const query = (body.query ?? "").trim();
  const snapshot = body.snapshot;
  if (!query || !snapshot) {
    return new Response(
      JSON.stringify({ error: "query and snapshot are required" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const enc = new TextEncoder();
  const sseEncode = (event: AgentEvent) =>
    enc.encode(`data: ${JSON.stringify(event)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        try {
          controller.enqueue(sseEncode(event));
        } catch {
          // Ignore events after the client disconnects.
        }
      };

      const ctx = createToolCtx(snapshot, send, body.userId);
      const emit = ctx.emit;
      emit({ type: "dock", state: "thinking" });
      emit({ type: "agent.status", status: `${activeModelSlug()} · thinking…` });
      emit({ type: "reply.start", query });

      try {
        const result = runOrchestrator({ ctx, query });
        let speaking = false;
        for await (const chunk of result.textStream) {
          if (!speaking) {
            emit({ type: "dock", state: "speaking" });
            speaking = true;
          }
          if (chunk.length > 0) emit({ type: "reply.chunk", text: chunk });
        }
        emit({ type: "reply.done" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[orchestrate] error:", message);
        emit({
          type: "ui.card",
          card: {
            id: `err-${Date.now()}`,
            kind: "toast",
            data: { text: `agent error · ${message.slice(0, 80)}` },
            ttl: 6000,
          },
        });
      } finally {
        emit({ type: "dock", state: "idle" });
        emit({ type: "agent.status", status: "" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-agent-model": activeModelSlug(),
    },
  });
}
