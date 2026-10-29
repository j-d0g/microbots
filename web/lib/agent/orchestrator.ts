import { streamText, stepCountIs } from "ai";
import { agentModel } from "./providers/openrouter";
import {
  graphTools,
  metaTools,
  v1WorkTools,
  type AgentToolCtx,
} from "./tools";
import { kgWriteTools } from "./kg-write-tools";
import { WINDOW_TOOL_FACTORIES } from "./window-tools";
import type { WindowKind } from "@/lib/store";
import { snapshotToPrompt } from "./server-snapshot";
import { retrieveSkills } from "./skill-retriever";

const ORCH_SYSTEM = `you are microbots, a warm and capable colleague. speak in lowercase, no emojis, and keep replies to one or two short sentences.

The user speaks or types naturally. Understand their intent, use the smallest useful set of tools, and ground answers in returned data. Never describe tool calls or claim work you did not do.

Use open_window to show a useful graph, memory, workflow, entity, skill, or integration card. In chat mode windows appear as inline cards, so prefer one or two focused cards and a short spoken-style answer. Use the optional focus argument to centre a specific node, entity, or workflow.

Use write tools only when the user asks to change or remember something. Ask a concise follow-up when intent is ambiguous. When the backend is degraded, say what is unavailable and offer what remains possible.

Window-specific tools are available for the most recently opened card. Use them to read or manipulate that card's data.`;

export interface OrchestrateInput {
  ctx: AgentToolCtx;
  query: string;
}

function getFocusedWindow(ctx: AgentToolCtx): {
  kind: WindowKind | null;
  source: "recent" | "none";
} {
  const recent = ctx.snapshot.windows.at(-1);
  return recent
    ? { kind: recent.kind, source: "recent" }
    : { kind: null, source: "none" };
}

export function runOrchestrator({ ctx, query }: OrchestrateInput) {
  const recent = getFocusedWindow(ctx);
  const windowTools = recent.kind
    ? WINDOW_TOOL_FACTORIES[recent.kind](ctx)
    : {};
  const windowToolNames = Object.keys(windowTools);
  const tools = {
    ...metaTools(ctx),
    ...v1WorkTools(ctx),
    ...kgWriteTools(ctx),
    ...graphTools(ctx),
    ...windowTools,
  };
  const skills = retrieveSkills(query, Object.keys(tools));
  const skillBlock = skills.length ? `\n\n${skills.join("\n---\n")}` : "";
  const stream = streamText({
    model: agentModel(),
    system: ORCH_SYSTEM + skillBlock,
    prompt: `${snapshotToPrompt(ctx.snapshot)}\n\nuser said: ${query}`,
    tools,
    stopWhen: stepCountIs(1),
    temperature: 0.2,
  });
  return Object.assign(stream, {
    diagnostics: {
      centreKind: recent.kind,
      centreSource: recent.source,
      windowToolNames,
      totalToolCount: Object.keys(tools).length,
    },
  });
}
