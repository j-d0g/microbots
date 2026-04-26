"use client";

import type { AgentEvent } from "./agent-client";

/**
 * Fallback when the orchestrate route is unavailable (no API key).
 * Shows a single toast telling the user to configure the key.
 * Replaces the previous scripted SCRIPTS fallback array.
 */
export async function* routeIntent(_q: string): AsyncGenerator<AgentEvent> {
  yield { type: "dock", state: "thinking" } as AgentEvent;
  await new Promise((r) => setTimeout(r, 200));
  yield {
    type: "ui.card",
    card: {
      id: `toast-no-key-${Date.now()}`,
      kind: "toast",
      data: {
        text: "agent unavailable — set OPENROUTER_API_KEY in .env.local to enable the live agent.",
      },
      ttl: 6000,
    },
  } as AgentEvent;
  yield { type: "dock", state: "idle" } as AgentEvent;
}
