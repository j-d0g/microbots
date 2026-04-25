/**
 * Layout sub-agent.
 *
 * Owns spatial reasoning. Receives an intent string from the
 * orchestrator + the live canvas snapshot, then issues a tight
 * sequence of `LAYOUT_TOOLS` calls (open / move / arrange / close /
 * focus / clear).
 *
 * Tiny system prompt — the layout vocabulary is small and we want
 * decisions in <150ms. We cap steps at 4 so a runaway agent can't
 * spin the canvas.
 */

import { streamText, stepCountIs } from "ai";
import { chatModel } from "./providers/openrouter";
import { layoutTools, type AgentToolCtx } from "./tools";
import { snapshotToPrompt } from "./server-snapshot";

const LAYOUT_SYSTEM = `you are the LAYOUT sub-agent for the microbots canvas.
your only job is to arrange floating windows on the user's screen.

vocabulary you must use:
- open_window(kind, mount?) — open or refocus a window
- close_window(id?, kind?) — close one
- move_window(id?, kind?, mount) — move/snap to a named anchor
- focus_window(id?, kind?) — bring forward
- arrange_windows(layout) — preset tile (focus|split|grid|stack-right)
- clear_canvas() — close all (use sparingly)

named mounts: full · left-half · right-half · top-half · bottom-half
              left-third · center-third · right-third
              tl · tr · bl · br · pip-br · pip-tr

rules:
- you NEVER write prose. you only call tools.
- if 2+ windows will be open after your turn, call arrange_windows once at the end.
- prefer presets over hand-placed mounts: split for 2, grid for 4, stack-right for main+sidebar.
- never close a window unless the user's intent is explicitly to close it.
- if the request makes no spatial sense (e.g. unrelated to layout), no-op (zero tool calls).

you have at most 4 steps. be decisive.`;

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
    stopWhen: stepCountIs(4),
    temperature: 0.2,
  });

  // Drain so all tool calls execute. We don't surface the layout-agent's
  // text — only the orchestrator speaks to the user.
  for await (const _chunk of result.textStream) {
    void _chunk;
  }

  return `layout-agent finished. canvas now has ${ctx.snapshot.windows.length} window(s).`;
}
