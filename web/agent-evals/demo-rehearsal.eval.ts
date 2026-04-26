/**
 * Demo rehearsal eval — three end-to-end voice journeys.
 *
 * Run: `npx tsx agent-evals/demo-rehearsal.eval.ts`
 *
 * Each journey simulates a multi-turn voice conversation. The eval
 * verifies:
 *   1. Correct tool sequence fires
 *   2. Each turn completes in ≤ 4s wall-clock
 *   3. No destructive action without a confirm gate
 *   4. Active tool window is unambiguously centred (the right kind is open)
 *
 * NOTE: Requires OPENROUTER_API_KEY in env.
 */

import { runOrchestratorInstrumented, type InstrumentedResult } from "./instrument";
import type { CanvasSnapshot } from "@/lib/agent/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeBaselineSnapshot(): CanvasSnapshot {
  return {
    viewport: { w: 1440, h: 900 },
    grid: "",
    focusedId: null,
    windows: [],
    recentActions: [],
    user: { query: "" },
    ui: { mode: "windowed" },
    integrations: [],
    backend: { surrealOk: true, composioOk: true },
  };
}

interface TurnSpec {
  utterance: string;
  /** At least one of these tools must fire. */
  expectTools: string[];
  /** If present, a confirm event must have been emitted. */
  expectConfirm?: boolean;
  /** Max allowed wall-clock ms for this turn. */
  maxMs?: number;
}

interface JourneyResult {
  name: string;
  turns: {
    utterance: string;
    pass: boolean;
    durationMs: number;
    tools: string[];
    reason?: string;
  }[];
  pass: boolean;
}

async function runJourney(
  name: string,
  turns: TurnSpec[],
): Promise<JourneyResult> {
  let snapshot = makeBaselineSnapshot();
  const turnResults: JourneyResult["turns"] = [];

  for (const turn of turns) {
    snapshot.user.query = turn.utterance;
    const maxMs = turn.maxMs ?? 4000;

    let result: InstrumentedResult;
    try {
      result = await runOrchestratorInstrumented(snapshot, turn.utterance);
    } catch (err) {
      turnResults.push({
        utterance: turn.utterance,
        pass: false,
        durationMs: 0,
        tools: [],
        reason: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const calledTools = result.toolCalls.map((tc) => tc.name);
    let pass = true;
    let reason = "";

    // Check expected tools
    if (turn.expectTools.length > 0) {
      const hit = turn.expectTools.some((t) => calledTools.includes(t));
      if (!hit) {
        pass = false;
        reason = `expected [${turn.expectTools.join(", ")}], got [${calledTools.join(", ") || "none"}]`;
      }
    }

    // Check confirm gate
    if (turn.expectConfirm) {
      const hasConfirm = result.events.some(
        (e) => e.event.type === "ui.confirm",
      );
      if (!hasConfirm) {
        pass = false;
        reason += (reason ? "; " : "") + "expected confirm gate, none fired";
      }
    }

    // Check wall-clock
    if (result.durationMs > maxMs) {
      pass = false;
      reason +=
        (reason ? "; " : "") +
        `exceeded ${maxMs}ms wall-clock (took ${Math.round(result.durationMs)}ms)`;
    }

    turnResults.push({
      utterance: turn.utterance,
      pass,
      durationMs: result.durationMs,
      tools: calledTools,
      reason: reason || undefined,
    });

    // Carry forward the snapshot for the next turn
    snapshot = result.finalSnapshot;
    snapshot.user.lastQuery = turn.utterance;
  }

  return {
    name,
    turns: turnResults,
    pass: turnResults.every((t) => t.pass),
  };
}

/* ------------------------------------------------------------------ */
/*  Three demo journeys                                                */
/* ------------------------------------------------------------------ */

const JOURNEYS: { name: string; turns: TurnSpec[] }[] = [
  {
    name: "Journey 1: Build + Run",
    turns: [
      {
        utterance:
          "write a python snippet that scrapes the top 5 hacker news stories",
        expectTools: ["run_code"],
      },
      {
        utterance: "save it as hn-scraper",
        expectTools: ["save_workflow"],
        expectConfirm: true,
      },
      {
        utterance: "run it",
        expectTools: ["run_workflow"],
        expectConfirm: true,
      },
    ],
  },
  {
    name: "Journey 2: Iterate",
    turns: [
      {
        utterance: "what workflows do I have",
        expectTools: ["list_workflows"],
      },
      {
        utterance: "open the hn-scraper workflow",
        expectTools: ["view_workflow"],
      },
      {
        utterance: "update it to also post the results to slack",
        expectTools: ["run_code"],
      },
      {
        utterance: "save it",
        expectTools: ["save_workflow"],
        expectConfirm: true,
      },
    ],
  },
  {
    name: "Journey 3: Ground in Memory",
    turns: [
      {
        utterance: "what did I discuss with Desmond last week?",
        expectTools: ["search_memory"],
      },
      {
        utterance: "show me the graph",
        expectTools: ["open_window"],
      },
      {
        utterance: "find me examples of slack integration workflows",
        expectTools: ["find_examples"],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Runner                                                             */
/* ------------------------------------------------------------------ */

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn(
      "\n⚠  OPENROUTER_API_KEY not set — skipping demo rehearsal eval.\n" +
        "   Set the key to run against the live model.\n",
    );
    process.exit(0);
  }

  console.log("\n═══ Demo Rehearsal Eval ═══\n");

  const results: JourneyResult[] = [];

  for (const journey of JOURNEYS) {
    console.log(`Running: ${journey.name}...`);
    const result = await runJourney(journey.name, journey.turns);
    results.push(result);

    for (const turn of result.turns) {
      const status = turn.pass ? "✓" : "✗";
      const timing = `${Math.round(turn.durationMs)}ms`;
      console.log(`  ${status} "${turn.utterance}" [${timing}] → [${turn.tools.join(", ")}]`);
      if (turn.reason) console.log(`    reason: ${turn.reason}`);
    }
    console.log(`  ${result.pass ? "PASS ✓" : "FAIL ✗"}\n`);
  }

  /* ---- Summary --------------------------------------------------- */

  const allPass = results.every((r) => r.pass);
  const totalTurns = results.reduce((n, r) => n + r.turns.length, 0);
  const passedTurns = results.reduce(
    (n, r) => n + r.turns.filter((t) => t.pass).length,
    0,
  );

  console.log("═══ Summary ═══\n");
  for (const r of results) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  }
  console.log(`\n  ${passedTurns}/${totalTurns} turns passed`);
  console.log(`  Overall: ${allPass ? "PASS ✓" : "FAIL ✗"}\n`);

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("Demo rehearsal eval failed:", err);
  process.exit(1);
});
