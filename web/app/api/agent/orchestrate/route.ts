import { NextRequest } from "next/server";
import type { AgentEvent } from "@/lib/agent-client";
import type { CanvasSnapshot } from "@/lib/agent/types";
import { hasOpenRouterKey, activeModelSlug, prewarmConnection } from "@/lib/agent/providers/openrouter";
import { runOrchestrator } from "@/lib/agent/orchestrator";
import type { AgentToolCtx } from "@/lib/agent/tools";
import {
  detectLeakedToolCall,
  applyRecoveredToolCall,
} from "@/lib/agent/leaked-tool-call";

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

        /* Surface centre-stage selection + tool-bag size to the
         * browser as a status string. This makes "is the in-window
         * tool wired up?" trivially observable in the
         * ConversationDebugger panel and in the dock status. */
        const d = result.diagnostics;
        emit({
          type: "agent.status",
          status: `centre=${d.centreKind ?? "none"} (${d.centreSource}) · ${d.windowToolNames.length} window tools · ${d.totalToolCount} total`,
        });

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
        let buffer = "";
        for await (const chunk of result.textStream) {
          if (!speaking) {
            emit({ type: "dock", state: "speaking" });
            speaking = true;
          }
          if (chunk.length > 0) {
            buffer += chunk;
            emit({ type: "reply.chunk", text: chunk });
          }
        }

        /* Recovery for gemini-2.5-flash-lite leaked tool-call syntax.
         * If the model produced text like `open_window(kind='profile')`
         * but never actually invoked the tool, parse the leaked text
         * and synthesize the UI events so the canvas still mutates.
         * See `web/lib/agent/leaked-tool-call.ts` for scope + rationale. */
        let realCalls: unknown[] = [];
        try {
          realCalls = (await result.toolCalls) ?? [];
        } catch {
          /* model errored before tool-call resolution — leave empty */
        }
        /* Tell the browser exactly what Gemini called this turn. If
         * the user reports "in-window tools aren't firing", this is
         * the line that proves whether the model called nothing,
         * called the wrong thing, or just leaked text. */
        const calledNames = realCalls
          .map((c) => {
            if (
              c &&
              typeof c === "object" &&
              "toolName" in c &&
              typeof (c as { toolName: unknown }).toolName === "string"
            ) {
              return (c as { toolName: string }).toolName;
            }
            return "?";
          })
          .filter((n) => n !== "?");
        emit({
          type: "agent.status",
          status:
            calledNames.length > 0
              ? `gemini called: ${calledNames.join(", ")}`
              : `gemini called: (no tools — text only)`,
        });
        if (realCalls.length === 0) {
          const recovered = detectLeakedToolCall(buffer);
          if (recovered) {
            emit({
              type: "agent.status",
              status: `recovered leaked tool-call from text`,
            });
            emit(recovered.marker.start);
            for (const e of recovered.events) emit(e);
            ctx.snapshot = applyRecoveredToolCall(ctx.snapshot, recovered);
            emit(recovered.marker.done);
          }
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
