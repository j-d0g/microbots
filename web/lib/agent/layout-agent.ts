/**
 * Layout sub-agent.
 *
 * Owns spatial reasoning. Receives an intent string from the
 * orchestrator + the live canvas snapshot, then issues a tight
 * sequence of `LAYOUT_TOOLS` calls (open / move / arrange / close /
 * focus / clear).
 *
 * Tiny system prompt — the layout vocabulary is small and we want
 * decisions in <150ms. We cap steps at 3 so a runaway agent can't
 * spin the canvas.
 */

import { streamText } from "ai";
import { chatModel } from "./providers/openrouter";
import { layoutTools, type AgentToolCtx } from "./tools";
import { snapshotToPrompt } from "./server-snapshot";

const BASE_CAP = 3;
const MAX_BONUS = 2;
const HARD_CEILING = 6;

/** Adaptive stop condition: base cap + 1 step per tool failure, hard ceiling.
 *  Emits `agent.tool.retry` events on the ctx when a bonus step is granted. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptiveStopCondition(ctx: AgentToolCtx): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ({ steps }: { steps: any[] }) => {
    let failures = 0;
    for (const step of steps) {
      for (const tr of step.toolResults ?? []) {
        const msg = typeof tr.result === "string" ? tr.result : "";
        if (msg.includes("fail") || msg.includes("No window matched") || msg.toLowerCase().includes("unknown") || msg.includes("needs an existing window")) {
          failures++;
        }
      }
    }
    const bonus = Math.min(failures, MAX_BONUS);
    const effectiveCap = Math.min(BASE_CAP + bonus, HARD_CEILING);
    if (bonus > 0 && steps.length === BASE_CAP) {
      ctx.emit({ type: "agent.tool.retry", bonus, effectiveCap });
    }
    return steps.length >= effectiveCap;
  };
}

const LAYOUT_SYSTEM = `LAYOUT sub-agent. arrange floating windows. NEVER write prose — tools only.

pick a preset NAME. presets have gutters/margins baked in (~2.5% outer, ~2% gutter). focused window = subject (slot 0).

PRESETS (arrange_windows):
  spotlight   subject ~75% centered + pip strip below  (DEFAULT for 1-2)
  split       2 equal columns                          (n=2)
  reading     60/40 main + sidebar                     (n=2)
  triptych    3 equal columns                          (n=3)
  theater     subject top + equal strip below           (1 hero + N)
  grid        2×2 or sqrt                              (n=4+)
  focus       subject ~78% centered + pip strip below   (n>=1)
  stack-right main + N stacked right                   (n>=2)

PICKER:
  1 window → spotlight · 2 equal → split · 2, 1 glance → spotlight
  2 reading → reading · 3 equal → triptych · 3 hero → theater
  4 → grid · 5+ → spotlight or close noise first
  "side by side" → split · "focus on X" → spotlight · "show all" → grid

RULES:
- arrange_windows after open/close if 2+ windows. one preset, stop.
- close noise first if 5+ windows and user asks about ONE thing.
- focus the discussed kind before arranging.
- set_window_rect only for outliers. default to preset.

at most 3 steps. snappy.`;

export async function runLayoutAgent(
  ctx: AgentToolCtx,
  intent: string,
): Promise<string> {
  const result = streamText({
    model: chatModel(),
    system: LAYOUT_SYSTEM,
    prompt: `${snapshotToPrompt(ctx.snapshot)}

intent: ${intent}`,
    tools: layoutTools(ctx),
    stopWhen: adaptiveStopCondition(ctx),
    temperature: 0.2,
  });

  // Wait for all steps (tool calls) to complete. We don't surface the
  // layout-agent's text — only the orchestrator speaks to the user.
  await result.steps;

  return `layout-agent finished. canvas now has ${ctx.snapshot.windows.length} window(s).`;
}
