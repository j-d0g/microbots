/**
 * Voice grammar eval — tests that voice verb phrasings map to the
 * correct V1 tool calls at ≥ 95% accuracy.
 *
 * Run: `npx tsx agent-evals/voice-grammar.eval.ts`
 *
 * Each verb from the orchestrator's §VOICE VERB MAPPING section is
 * tested across 5 phrasings. The eval runs each phrasing through
 * `runOrchestratorInstrumented` and checks that the expected tool
 * was called (or that no tool was called, for low-signal turns).
 *
 * NOTE: Requires OPENROUTER_API_KEY in env. If missing, prints a
 * warning and exits 0 (non-blocking in CI).
 */

import { runOrchestratorInstrumented } from "./instrument";
import type { CanvasSnapshot } from "@/lib/agent/types";

/* ------------------------------------------------------------------ */
/*  Test corpus: verb → expected tool(s)                               */
/* ------------------------------------------------------------------ */

interface VoiceCase {
  phrase: string;
  /** At least one of these tools must appear in the tool calls. */
  expectTools: string[];
  /** None of these tools should appear. */
  rejectTools?: string[];
}

interface VerbGroup {
  verb: string;
  cases: VoiceCase[];
}

const CORPUS: VerbGroup[] = [
  {
    verb: "build / write / draft → run_code",
    cases: [
      { phrase: "build a python snippet that scrapes hacker news", expectTools: ["run_code"] },
      { phrase: "write me a script to parse CSV files", expectTools: ["run_code"] },
      { phrase: "draft a quick function to sort by priority", expectTools: ["run_code"] },
      { phrase: "can you code something that checks SSL certs", expectTools: ["run_code"] },
      { phrase: "whip up a little thing that pings my endpoints", expectTools: ["run_code"] },
    ],
  },
  {
    verb: "save / save as X → save_workflow",
    cases: [
      { phrase: "save it", expectTools: ["save_workflow"] },
      { phrase: "save it as bug-triage", expectTools: ["save_workflow"] },
      { phrase: "save this workflow as daily-standup", expectTools: ["save_workflow"] },
      { phrase: "persist that as ssl-checker", expectTools: ["save_workflow"] },
      { phrase: "keep that, call it inbox-sweep", expectTools: ["save_workflow"] },
    ],
  },
  {
    verb: "show me X / open X → search_memory or view_workflow",
    cases: [
      { phrase: "show me what I discussed with Desmond", expectTools: ["search_memory"] },
      { phrase: "open the bug-triage workflow", expectTools: ["view_workflow"] },
      { phrase: "show me the slack conversation from yesterday", expectTools: ["search_memory"] },
      { phrase: "pull up the daily-standup workflow", expectTools: ["view_workflow"] },
      { phrase: "what was that thing about the rate limit?", expectTools: ["search_memory"] },
    ],
  },
  {
    verb: "run / run it → run_workflow",
    cases: [
      { phrase: "run it", expectTools: ["run_workflow"] },
      { phrase: "run bug-triage", expectTools: ["run_workflow"] },
      { phrase: "execute the daily-standup workflow", expectTools: ["run_workflow"] },
      { phrase: "go ahead and run that", expectTools: ["run_workflow"] },
      { phrase: "kick off inbox-sweep", expectTools: ["run_workflow"] },
    ],
  },
  {
    verb: "what have I built → list_workflows",
    cases: [
      { phrase: "what have I built", expectTools: ["list_workflows"] },
      { phrase: "show me all my workflows", expectTools: ["list_workflows"] },
      { phrase: "what workflows do I have", expectTools: ["list_workflows"] },
      { phrase: "list everything I've saved", expectTools: ["list_workflows"] },
      { phrase: "what's in my library", expectTools: ["list_workflows"] },
    ],
  },
  {
    verb: "show examples → find_examples",
    cases: [
      { phrase: "show me some examples", expectTools: ["find_examples"] },
      { phrase: "what examples are there for slack bots", expectTools: ["find_examples"] },
      { phrase: "give me example workflows", expectTools: ["find_examples"] },
      { phrase: "any templates I can start from?", expectTools: ["find_examples"] },
      { phrase: "show me what other people have built", expectTools: ["find_examples"] },
    ],
  },
  {
    verb: "quiet / shh → quiet mode",
    cases: [
      { phrase: "quiet", expectTools: [], rejectTools: ["run_code", "save_workflow", "run_workflow"] },
      { phrase: "shh", expectTools: [], rejectTools: ["run_code", "save_workflow", "run_workflow"] },
      { phrase: "mute", expectTools: [], rejectTools: ["run_code", "save_workflow", "run_workflow"] },
      { phrase: "go silent", expectTools: [], rejectTools: ["run_code", "save_workflow", "run_workflow"] },
      { phrase: "quiet mode", expectTools: [], rejectTools: ["run_code", "save_workflow", "run_workflow"] },
    ],
  },
  {
    verb: "clear / clean slate → clear_canvas",
    cases: [
      { phrase: "clean slate", expectTools: ["clear_canvas"] },
      { phrase: "clear everything", expectTools: ["clear_canvas"] },
      { phrase: "close all windows", expectTools: ["clear_canvas", "close_window"] },
      { phrase: "start fresh", expectTools: ["clear_canvas"] },
      { phrase: "wipe the canvas", expectTools: ["clear_canvas"] },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Baseline snapshot                                                   */
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

/* ------------------------------------------------------------------ */
/*  Runner                                                             */
/* ------------------------------------------------------------------ */

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn(
      "\n⚠  OPENROUTER_API_KEY not set — skipping voice grammar eval.\n" +
        "   Set the key to run against the live model.\n",
    );
    process.exit(0);
  }

  const results: { phrase: string; verb: string; pass: boolean; tools: string[]; reason?: string }[] = [];

  for (const group of CORPUS) {
    for (const c of group.cases) {
      const snap = makeBaselineSnapshot();
      snap.user.query = c.phrase;

      try {
        const result = await runOrchestratorInstrumented(snap, c.phrase);
        const calledTools = result.toolCalls.map((tc) => tc.name);

        let pass = true;
        let reason = "";

        if (c.expectTools.length > 0) {
          // At least one expected tool must appear
          const hit = c.expectTools.some((t) => calledTools.includes(t));
          if (!hit) {
            pass = false;
            reason = `expected one of [${c.expectTools.join(", ")}], got [${calledTools.join(", ") || "none"}]`;
          }
        }

        if (c.rejectTools) {
          const rejected = c.rejectTools.filter((t) => calledTools.includes(t));
          if (rejected.length > 0) {
            pass = false;
            reason = `rejected tools called: [${rejected.join(", ")}]`;
          }
        }

        results.push({ phrase: c.phrase, verb: group.verb, pass, tools: calledTools, reason });
      } catch (err) {
        results.push({
          phrase: c.phrase,
          verb: group.verb,
          pass: false,
          tools: [],
          reason: `error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  /* ---- Report ---------------------------------------------------- */

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const pct = ((passed / total) * 100).toFixed(1);
  const target = 95;

  console.log("\n═══ Voice Grammar Eval ═══\n");
  console.log(`${passed} / ${total} passed (${pct}%)\n`);

  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log("Failures:\n");
    for (const f of failures) {
      console.log(`  ✗ "${f.phrase}"`);
      console.log(`    verb: ${f.verb}`);
      console.log(`    tools: [${f.tools.join(", ")}]`);
      if (f.reason) console.log(`    reason: ${f.reason}`);
      console.log();
    }
  }

  // Per-verb breakdown
  console.log("Per-verb breakdown:\n");
  for (const group of CORPUS) {
    const groupResults = results.filter((r) => r.verb === group.verb);
    const groupPassed = groupResults.filter((r) => r.pass).length;
    const status = groupPassed === groupResults.length ? "✓" : "✗";
    console.log(`  ${status} ${group.verb}: ${groupPassed}/${groupResults.length}`);
  }

  console.log(`\nTarget: ≥ ${target}% — ${Number(pct) >= target ? "PASS ✓" : "FAIL ✗"}\n`);

  process.exit(Number(pct) >= target ? 0 : 1);
}

main().catch((err) => {
  console.error("Voice grammar eval failed:", err);
  process.exit(1);
});
