#!/usr/bin/env tsx
/**
 * Eval harness entry point.
 *
 * Reads the corpus, runs each query through the instrumented
 * orchestrator, scores with the rule-based judge, and writes a JSON
 * report + a markdown delta table to stdout.
 *
 * Usage:
 *   npm run agent:eval           # full 80-query run
 *   npm run agent:eval:quick     # 10-query sample (≥1 per category)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { runOrchestratorInstrumented, type InstrumentedResult } from "./instrument";
import { judgeQuery, type JudgeResult, type QueryExpected } from "./judge";
import type { CanvasSnapshot } from "@/lib/agent/types";

/* ------------------------------------------------------------------ *
 *  Types for the corpus YAML
 * ------------------------------------------------------------------ */

interface CorpusQuery {
  id: string;
  category: string;
  query: string;
  notes?: string;
}

/* ------------------------------------------------------------------ *
 *  CLI arg parsing
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const isQuick = args.includes("--quick");
const CONCURRENCY = 1; // sequential to avoid rate-limit issues

/* ------------------------------------------------------------------ *
 *  Load corpus + expectations
 * ------------------------------------------------------------------ */

const EVAL_DIR = dirname(new URL(import.meta.url).pathname);
const CORPUS_PATH = resolve(EVAL_DIR, "corpus/queries.yaml");
const EXPECTED_PATH = resolve(EVAL_DIR, "corpus/expected.yaml");
const REPORTS_DIR = resolve(EVAL_DIR, "reports");

const allQueries: CorpusQuery[] = parseYaml(readFileSync(CORPUS_PATH, "utf-8"));
const allExpected: QueryExpected[] = parseYaml(
  readFileSync(EXPECTED_PATH, "utf-8"),
);

const expectedMap = new Map(allExpected.map((e) => [e.id, e]));

/* ------------------------------------------------------------------ *
 *  Quick-mode: sample ≥1 per category
 * ------------------------------------------------------------------ */

function sampleQuick(queries: CorpusQuery[]): CorpusQuery[] {
  const byCategory = new Map<string, CorpusQuery[]>();
  for (const q of queries) {
    const list = byCategory.get(q.category) ?? [];
    list.push(q);
    byCategory.set(q.category, list);
  }
  const sampled: CorpusQuery[] = [];
  for (const [, list] of byCategory) {
    // Take first 2 from each category (or 1 if only 1)
    sampled.push(...list.slice(0, Math.min(2, list.length)));
  }
  return sampled.slice(0, 12); // cap at ~12 for quick mode
}

const queries = isQuick ? sampleQuick(allQueries) : allQueries;

/* ------------------------------------------------------------------ *
 *  Build a fresh starting snapshot (empty canvas, default viewport)
 * ------------------------------------------------------------------ */

function freshSnapshot(): CanvasSnapshot {
  return {
    viewport: { w: 1920, h: 1080 },
    grid: Array.from({ length: 8 }, () => Array(12).fill("·").join(" ")).join(
      "\n",
    ),
    focusedId: null,
    windows: [],
    recentActions: [],
    user: { query: "" },
  };
}

/* ------------------------------------------------------------------ *
 *  Run loop
 * ------------------------------------------------------------------ */

interface QueryResult {
  query: CorpusQuery;
  instrumented: InstrumentedResult;
  judge: JudgeResult;
}

async function runAll(): Promise<QueryResult[]> {
  const results: QueryResult[] = [];
  const total = queries.length;

  for (let i = 0; i < total; i++) {
    const q = queries[i];
    const expected = expectedMap.get(q.id);
    if (!expected) {
      console.warn(`⚠ no expected.yaml entry for ${q.id}, skipping`);
      continue;
    }

    const label = `[${i + 1}/${total}] ${q.id}`;
    process.stdout.write(`${label} "${q.query.slice(0, 50)}" ... `);

    const snapshot = freshSnapshot();
    let instrumented: InstrumentedResult;

    try {
      instrumented = await runOrchestratorInstrumented(snapshot, q.query);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${msg.slice(0, 80)}`);
      instrumented = {
        events: [],
        replyText: "",
        durationMs: 0,
        ttfwMs: null,
        toolCalls: [],
        finalSnapshot: snapshot,
        error: msg,
      };
    }

    const judged = judgeQuery(q.id, q.category, instrumented, expected);
    results.push({ query: q, instrumented, judge: judged });

    const mark = judged.passed ? "PASS" : "FAIL";
    const tools = judged.toolCallNames.join(",") || "(none)";
    console.log(
      `${mark} · ${Math.round(instrumented.durationMs)}ms · tools=[${tools}]`,
    );
  }

  return results;
}

/* ------------------------------------------------------------------ *
 *  Aggregate metrics
 * ------------------------------------------------------------------ */

interface AggregateMetrics {
  total: number;
  passed: number;
  passRate: number;
  toolCallCorrectness: number;
  ttfwP50: number;
  fullTurnP50: number;
  fullTurnP95: number;
  meanToolCallsMultiStep: number;
  marginalPassRate: number;
  recoveryRate: number;
  calmCanvasAvg: number;
  layoutAestheticAvg: number;
  warmthAvg: number;
  conversationalPassRate: number;
  perCategory: Record<
    string,
    { total: number; passed: number; passRate: number }
  >;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, i)];
}

function aggregate(results: QueryResult[]): AggregateMetrics {
  const total = results.length;
  const passed = results.filter((r) => r.judge.passed).length;

  // Tool-call correctness: mean score / 5
  const tcScores = results.map(
    (r) => r.judge.axes.tool_call_correctness.score / 5,
  );
  const toolCallCorrectness =
    tcScores.reduce((a, b) => a + b, 0) / Math.max(tcScores.length, 1);

  // Latency
  const ttfws = results
    .filter((r) => r.instrumented.ttfwMs !== null && !r.instrumented.error)
    .map((r) => r.instrumented.ttfwMs!);
  const fullTurns = results
    .filter((r) => !r.instrumented.error)
    .map((r) => r.instrumented.durationMs);

  // Multi-step: mean tool calls on multi_step subset
  const multiStepResults = results.filter(
    (r) => r.query.category === "multi_step",
  );
  const multiStepToolCounts = multiStepResults.map((r) =>
    r.instrumented.toolCalls.filter((t) => !t.name.startsWith("delegate_"))
      .length,
  );
  const meanToolCallsMultiStep =
    multiStepToolCounts.reduce((a, b) => a + b, 0) /
    Math.max(multiStepToolCounts.length, 1);

  // Marginal pass rate
  const marginalResults = results.filter(
    (r) => r.query.category === "marginal",
  );
  const marginalPassed = marginalResults.filter((r) => r.judge.passed).length;
  const marginalPassRate =
    marginalPassed / Math.max(marginalResults.length, 1);

  // Recovery rate
  const allFailedTools = results.flatMap((r) =>
    r.instrumented.toolCalls.filter((t) => !t.ok),
  );
  let retries = 0;
  for (const r of results) {
    for (let i = 0; i < r.instrumented.toolCalls.length; i++) {
      if (!r.instrumented.toolCalls[i].ok) {
        for (let j = i + 1; j < r.instrumented.toolCalls.length; j++) {
          if (r.instrumented.toolCalls[j].ok) {
            retries++;
            break;
          }
        }
      }
    }
  }
  const recoveryRate =
    allFailedTools.length > 0 ? retries / allFailedTools.length : 1.0;

  // Calm canvas average
  const calmScores = results.map((r) => r.judge.axes.calm_canvas.score);
  const calmCanvasAvg =
    calmScores.reduce((a, b) => a + b, 0) / Math.max(calmScores.length, 1);

  // Layout aesthetic average
  const aestheticScores = results.map((r) => r.judge.axes.layout_aesthetic.score);
  const layoutAestheticAvg =
    aestheticScores.reduce((a, b) => a + b, 0) / Math.max(aestheticScores.length, 1);

  // Warmth average (conversational + marginal queries)
  const warmthResults = results.filter(
    (r) =>
      r.query.category === "conversational" || r.query.category === "marginal",
  );
  const warmthScores = warmthResults.map((r) => r.judge.axes.warmth.score);
  const warmthAvg =
    warmthScores.reduce((a, b) => a + b, 0) / Math.max(warmthScores.length, 1);

  // Conversational pass rate
  const convResults = results.filter(
    (r) => r.query.category === "conversational",
  );
  const convPassed = convResults.filter((r) => r.judge.passed).length;
  const conversationalPassRate =
    convPassed / Math.max(convResults.length, 1);

  // Per-category
  const perCategory: AggregateMetrics["perCategory"] = {};
  for (const r of results) {
    const cat = r.query.category;
    if (!perCategory[cat]) perCategory[cat] = { total: 0, passed: 0, passRate: 0 };
    perCategory[cat].total++;
    if (r.judge.passed) perCategory[cat].passed++;
  }
  for (const cat of Object.values(perCategory)) {
    cat.passRate = cat.passed / Math.max(cat.total, 1);
  }

  return {
    total,
    passed,
    passRate: passed / Math.max(total, 1),
    toolCallCorrectness,
    ttfwP50: percentile(ttfws, 50),
    fullTurnP50: percentile(fullTurns, 50),
    fullTurnP95: percentile(fullTurns, 95),
    meanToolCallsMultiStep,
    marginalPassRate,
    recoveryRate,
    calmCanvasAvg,
    layoutAestheticAvg,
    warmthAvg,
    conversationalPassRate,
    perCategory,
  };
}

/* ------------------------------------------------------------------ *
 *  Output: report JSON + delta table
 * ------------------------------------------------------------------ */

function getGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function writeReport(
  results: QueryResult[],
  metrics: AggregateMetrics,
): string {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const sha = getGitSha();
  const name = `${date}-baseline-${sha}.json`;
  const outPath = resolve(REPORTS_DIR, name);

  const report = {
    meta: {
      date: new Date().toISOString(),
      sha,
      model: process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash-lite",
      quick: isQuick,
      totalQueries: metrics.total,
    },
    metrics,
    results: results.map((r) => ({
      id: r.query.id,
      category: r.query.category,
      query: r.query.query,
      passed: r.judge.passed,
      durationMs: Math.round(r.instrumented.durationMs),
      ttfwMs: r.instrumented.ttfwMs
        ? Math.round(r.instrumented.ttfwMs)
        : null,
      toolCalls: r.judge.toolCallNames,
      subAgentToolCalls: r.instrumented.toolCalls
        .filter((t) => !t.name.startsWith("delegate_"))
        .map((t) => ({
          name: t.name,
          durationMs: Math.round(t.durationMs),
          ok: t.ok,
        })),
      replyText: r.judge.replyText,
      error: r.instrumented.error,
      axes: r.judge.axes,
    })),
  };

  writeFileSync(outPath, JSON.stringify(report, null, 2));
  return name;
}

function printDeltaTable(metrics: AggregateMetrics): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log("\n## Eval delta table\n");
  console.log("| Metric | Value |");
  console.log("|---|---|");
  console.log(
    `| Tool-call correctness | ${pct(metrics.toolCallCorrectness)} |`,
  );
  console.log(`| TTFW p50 | ${Math.round(metrics.ttfwP50)}ms |`);
  console.log(
    `| Full-turn p50 / p95 | ${Math.round(metrics.fullTurnP50)}ms / ${Math.round(metrics.fullTurnP95)}ms |`,
  );
  console.log(
    `| Mean tool calls (multi_step) | ${metrics.meanToolCallsMultiStep.toFixed(1)} |`,
  );
  console.log(`| Marginal-intent pass-rate | ${pct(metrics.marginalPassRate)} |`);
  console.log(`| Recovery rate | ${pct(metrics.recoveryRate)} |`);
  console.log(`| Calm-canvas avg | ${(metrics.calmCanvasAvg).toFixed(1)} / 5 |`);
  console.log(`| Layout aesthetic avg | ${(metrics.layoutAestheticAvg).toFixed(1)} / 5 |`);
  console.log(`| Warmth avg (conv+marginal) | ${(metrics.warmthAvg).toFixed(1)} / 5 |`);
  console.log(`| Conversational pass-rate | ${pct(metrics.conversationalPassRate)} |`);

  console.log("\n### Per-category\n");
  console.log("| Category | Pass | Total | Rate |");
  console.log("|---|---|---|---|");
  for (const [cat, data] of Object.entries(metrics.perCategory)) {
    console.log(`| ${cat} | ${data.passed} | ${data.total} | ${pct(data.passRate)} |`);
  }
}

/* ------------------------------------------------------------------ *
 *  Main
 * ------------------------------------------------------------------ */

async function main() {
  console.log(
    `\n🔬 microbots eval harness · ${isQuick ? "QUICK" : "FULL"} · ${queries.length} queries\n`,
  );

  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      "ERROR: OPENROUTER_API_KEY not set. The eval needs it to run the live agent.",
    );
    process.exit(1);
  }

  const results = await runAll();
  const metrics = aggregate(results);
  const reportName = writeReport(results, metrics);

  printDeltaTable(metrics);
  console.log(`\nReport written: agent-evals/reports/${reportName}`);

  if (metrics.passRate < 0.5) {
    console.error(`\n⚠ Overall pass rate ${(metrics.passRate * 100).toFixed(1)}% is below 50% — broken harness?`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
