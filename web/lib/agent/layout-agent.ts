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

═══ MODE-AWARE WINDOW KINDS ═══
read <canvas mode=…> in the snapshot.

WINDOWED mode → only three kinds exist:
  - settings        — required first; user_id lives here
  - integration     — one per toolkit slug. open with
                      open_window(kind="integration", slug="<slug>").
                      slugs: slack, github, gmail, linear, notion,
                      perplexityai. multiple integration windows can
                      coexist; they're disambiguated by slug.
  - graph           — knowledge graph viz, fed by /api/kg

  IF user_id is NOT_SET in the snapshot, open the SETTINGS window as
  subject and stop. nothing else makes sense yet.

CHAT mode → all seven legacy kinds: brief, graph, workflow, stack,
waffle, playbooks, settings. (chat mode rarely needs layout — most
chat-mode events are handled by setChatRoom on the client.)

═══ TOOLS ═══
  open_window(kind, mount?, slug?)   open or refocus a window. for
                                     kind="integration" pass slug.
  close_window(id?, kind?)           close ONE window — use this often,
                                     a clean canvas is a calm canvas.
                                     when you have multiple integration
                                     windows, prefer the id from the
                                     snapshot to disambiguate.
  move_window(id?, kind?, mount)     snap to a NAMED anchor
  focus_window(id?, kind?)           bring forward
  arrange_windows(layout)            ★ DEFAULT TOOL ★ pick a preset
  set_window_rect(id?, kind?, rect)  free-form % rect — only when no
                                     preset fits (rare, ~5% of cases)
  clear_canvas()                     close everything (sparing)

PRESETS (arrange_windows):
  spotlight   subject ~75% centered + pip strip below  (DEFAULT for 1-2)
  split       2 equal columns                          (n=2)
  reading     60/40 main + sidebar                     (n=2)
  triptych    3 equal columns                          (n=3)
  theater     subject top + equal strip below           (1 hero + N)
  grid        2×2 or sqrt                              (n=4+)
  focus       subject ~78% centered + pip strip below   (n>=1)
  stack-right main + N stacked right                   (n>=2)

═══ PICKER (do not deliberate — use this) ═══
  → 1 window         focus
  → 2 equal weight   split
  → 2, 1 is glance   spotlight
  → 2 reading        reading
  → 3 equal          triptych
  → 3, 1 is hero     theater  or  spotlight
  → 4                grid
  → 5+               focus / spotlight  OR  close some first
  user says…
    "connect X"      → open the integration window for X as subject
                       (open_window kind=integration slug=X), then focus
    "show all my
     connections"    → open all 6 integration windows, arrange grid
    "graph"          → open_window(graph) as subject, focus
    "set up"         → open settings as subject

═══ HARD RULES ═══
- WINDOW BOUNDARIES NEVER TOUCH. presets bake in a 2.5% gutter; you
  must NEVER nudge windows so their edges abut.
- ALWAYS call arrange_windows after opening or closing a window if 2+
  remain. one preset call, then stop.
- CLOSE NOISE. if the canvas has 5+ windows and the user is asking
  about ONE thing, close the irrelevant ones FIRST, then arrange.
- in WINDOWED mode, NEVER open brief / workflow / stack / waffle /
  playbooks. the simulator will refuse and you'll waste a step.

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
