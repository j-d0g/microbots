import { NextRequest } from "next/server";
import type { AgentEvent } from "@/lib/agent-client";
import type { CanvasSnapshot } from "@/lib/agent/types";
import { hasOpenRouterKey, activeModelSlug, prewarmConnection } from "@/lib/agent/providers/openrouter";
import { runOrchestrator } from "@/lib/agent/orchestrator";
import type { AgentToolCtx } from "@/lib/agent/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  query?: string;
  snapshot?: CanvasSnapshot;
}

/**
 * POST /api/agent/orchestrate
 *
 * Body: { query: string, snapshot: CanvasSnapshot }
 *
 * Streams SSE events: ui.* (window mutations), agent.delegate /
 * agent.tool.* (sidecar log), reply.* (streamed text), dock state.
 *
 * No key set → 503 + `X-Agent-Fallback: local` header so the client
 * can degrade to the scripted `routeIntent()` fallback.
 */
export async function POST(req: NextRequest) {
  prewarmConnection();
  if (!hasOpenRouterKey()) {
    return new Response(
      JSON.stringify({
        error: "missing OPENROUTER_API_KEY",
        fallback: "local",
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "x-agent-fallback": "local",
        },
      },
    );
  }

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
  const sseEncode = (e: AgentEvent) =>
    enc.encode(`data: ${JSON.stringify(e)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        try {
          controller.enqueue(sseEncode(e));
        } catch {
          // controller closed mid-stream — ignore.
        }
      };

      const ctx: AgentToolCtx = { snapshot, emit };

      emit({ type: "dock", state: "thinking" });
      emit({
        type: "agent.status",
        status: `${activeModelSlug()} · thinking…`,
      });

      try {
        const result = runOrchestrator({ ctx, query });
        // Two parallel streams from one streamText() result:
        //   - textStream: orchestrator's reply text (drives reply.chunk)
        //   - tool calls: handled internally via ctx.emit from tool handlers
        //
        // Emit reply.start unconditionally so the client clears any
        // stale `agentReply` from the previous turn — otherwise tools-
        // only turns leave the windowed-mode dock narrating an outdated
        // reply while the canvas mutates. The chat-history slot is
        // created lazily on first reply.chunk in agent-client.ts so
        // tools-only turns don't leave empty agent bubbles.
        emit({ type: "reply.start", query });
        let speaking = false;
        for await (const chunk of result.textStream) {
          if (!speaking) {
            emit({ type: "dock", state: "speaking" });
            speaking = true;
          }
          if (chunk.length > 0) emit({ type: "reply.chunk", text: chunk });
        }
        emit({ type: "reply.done" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("[orchestrate] error:", msg);
        emit({
          type: "ui.card",
          card: {
            id: `err-${Date.now()}`,
            kind: "toast",
            data: { text: `agent error · ${msg.slice(0, 80)}` },
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
