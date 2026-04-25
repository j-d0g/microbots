/**
 * Instrumented orchestrator wrapper.
 *
 * Wraps `runOrchestrator` to capture per-tool timing, retry tracking,
 * event transcripts, and latency metrics (TTFW, full-turn). Exports
 * `runOrchestratorInstrumented(snapshot, query)` — the sole entry
 * point the eval harness uses.
 */

import { runOrchestrator } from "@/lib/agent/orchestrator";
import type { AgentToolCtx } from "@/lib/agent/tools";
import type { AgentEvent } from "@/lib/agent-client";
import type { CanvasSnapshot } from "@/lib/agent/types";

export interface TimedEvent {
  ts: number;
  event: AgentEvent;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  startMs: number;
  endMs: number;
  durationMs: number;
  ok: boolean;
}

export interface InstrumentedResult {
  events: TimedEvent[];
  replyText: string;
  durationMs: number;
  /** Time-to-first ui.* or agent.tool.* event (ms from start). */
  ttfwMs: number | null;
  toolCalls: ToolCallRecord[];
  /** Snapshot after all tools have run. */
  finalSnapshot: CanvasSnapshot;
  error: string | null;
}

export async function runOrchestratorInstrumented(
  snapshot: CanvasSnapshot,
  query: string,
): Promise<InstrumentedResult> {
  const events: TimedEvent[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const pendingTools = new Map<string, { startMs: number; args: Record<string, unknown> }>();

  const t0 = performance.now();
  let ttfwMs: number | null = null;

  const emit = (event: AgentEvent) => {
    const ts = performance.now() - t0;
    events.push({ ts, event });

    // Track TTFW: first ui.* or agent.tool.start event
    if (ttfwMs === null) {
      if (
        event.type.startsWith("ui.") ||
        event.type === "agent.tool.start"
      ) {
        ttfwMs = ts;
      }
    }

    // Track tool start/end
    if (event.type === "agent.tool.start") {
      pendingTools.set(event.name, { startMs: ts, args: event.args });
    }
    if (event.type === "agent.tool.done") {
      const start = pendingTools.get(event.name);
      if (start) {
        toolCalls.push({
          name: event.name,
          args: start.args,
          startMs: start.startMs,
          endMs: ts,
          durationMs: ts - start.startMs,
          ok: event.ok,
        });
        pendingTools.delete(event.name);
      }
    }
  };

  const ctx: AgentToolCtx = { snapshot: structuredClone(snapshot), emit };
  let replyText = "";
  let error: string | null = null;

  try {
    const result = runOrchestrator({ ctx, query });
    let started = false;
    for await (const chunk of result.textStream) {
      if (!started) {
        emit({ type: "reply.start", query });
        started = true;
      }
      if (chunk.length > 0) {
        emit({ type: "reply.chunk", text: chunk });
        replyText += chunk;
      }
    }
    if (started) {
      emit({ type: "reply.done" });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const durationMs = performance.now() - t0;

  return {
    events,
    replyText,
    durationMs,
    ttfwMs,
    toolCalls,
    finalSnapshot: ctx.snapshot,
    error,
  };
}
