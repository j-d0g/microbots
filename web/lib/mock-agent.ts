/** Mocked agent event stream. When NEXT_PUBLIC_MOCK_AGENT=true the
 *  /api/agent/stream route emits these on a timer so the UI has something
 *  to react to while backend infra is offline. */

import type { AgentEvent } from "./agent-client";

export const mockTimeline: Array<{ at: number; event: AgentEvent }> = [
  {
    at: 400,
    event: { type: "agent.status", status: "reading last night's signal…" },
  },
  { at: 2000, event: { type: "dock", state: "thinking" } },
  {
    at: 3800,
    event: {
      type: "ui.card",
      card: {
        id: "toast-morning",
        kind: "toast",
        data: { text: "3 automations ready for you." },
        ttl: 4000,
      },
    },
  },
  {
    at: 4200,
    event: { type: "agent.status", status: "morning. here are three." },
  },
  { at: 4400, event: { type: "dock", state: "speaking" } },
  {
    at: 5200,
    event: {
      type: "ui.card",
      card: {
        id: "mem-1",
        kind: "memory",
        data: {
          text: "You triage Slack #product-bugs into Linear every weekday morning.",
          confidence: 0.94,
        },
        ttl: 6000,
      },
    },
  },
  { at: 7000, event: { type: "dock", state: "idle" } },
  { at: 7200, event: { type: "agent.status", status: "" } },
];

export async function* mockAgentStream(): AsyncGenerator<AgentEvent> {
  const t0 = Date.now();
  for (const step of mockTimeline) {
    const wait = step.at - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    yield step.event;
  }
}
