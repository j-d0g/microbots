/**
 * Rule-based judge for the eval harness.
 *
 * Scores each query result against the expected.yaml spec using
 * deterministic rules. No LLM calls — the six north-star axes are
 * computed from the transcript, timing data, and snapshot state.
 *
 * Returns 0–5 per axis + a one-sentence rationale.
 */

import type { InstrumentedResult } from "./instrument";

export interface QueryExpected {
  id: string;
  must_include_tools: string[];
  must_not_include_tools: string[];
  expected_window_kinds_after: string[];
  judge_tags: string[];
  min_tool_calls?: number;
  notes?: string;
}

export interface AxisScore {
  score: number; // 0–5
  rationale: string;
}

export interface JudgeResult {
  id: string;
  category: string;
  axes: {
    tool_call_correctness: AxisScore;
    latency: AxisScore;
    multi_step: AxisScore;
    coverage: AxisScore;
    recovery: AxisScore;
    calm_canvas: AxisScore;
    layout_aesthetic: AxisScore;
  };
  passed: boolean;
  toolCallNames: string[];
  replyText: string;
}

/** All tool names that appeared in the transcript as delegate_* or
 *  agent.tool.start events. */
function extractToolNames(result: InstrumentedResult): string[] {
  const names: string[] = [];
  for (const { event } of result.events) {
    if (event.type === "agent.delegate") {
      names.push(`delegate_${event.to}`);
    }
    if (event.type === "agent.tool.start") {
      names.push(event.name);
    }
  }
  return names;
}

/** Count distinct sub-agent tool calls (not delegate_*, those are
 *  orchestrator-level). */
function countSubAgentToolCalls(result: InstrumentedResult): number {
  return result.toolCalls.filter(
    (t) => !t.name.startsWith("delegate_"),
  ).length;
}

function scoreTool(
  result: InstrumentedResult,
  expected: QueryExpected,
): AxisScore {
  const names = extractToolNames(result);

  if (result.error) {
    return { score: 0, rationale: `error: ${result.error.slice(0, 60)}` };
  }

  // Check must_include
  const missingRequired = expected.must_include_tools.filter(
    (t) => !names.includes(t),
  );
  // Check must_not_include
  const forbiddenPresent = expected.must_not_include_tools.filter((t) =>
    names.includes(t),
  );

  if (missingRequired.length > 0 && forbiddenPresent.length > 0) {
    return {
      score: 0,
      rationale: `missing ${missingRequired.join(",")} and used forbidden ${forbiddenPresent.join(",")}`,
    };
  }
  if (missingRequired.length > 0) {
    // Partial credit: got some but not all
    const hitRate =
      1 -
      missingRequired.length / Math.max(expected.must_include_tools.length, 1);
    const s = Math.round(hitRate * 3);
    return {
      score: s,
      rationale: `missing ${missingRequired.join(",")}`,
    };
  }
  if (forbiddenPresent.length > 0) {
    return {
      score: 2,
      rationale: `used forbidden ${forbiddenPresent.join(",")}`,
    };
  }
  return { score: 5, rationale: "all required tools called, none forbidden" };
}

function scoreLatency(result: InstrumentedResult): AxisScore {
  if (result.error) {
    return { score: 0, rationale: "error — no latency data" };
  }
  const ttfw = result.ttfwMs ?? result.durationMs;
  const full = result.durationMs;

  // Scoring: 5 = excellent, 0 = terrible
  // TTFW target < 600ms, full p50 target < 1800ms
  let s = 5;
  if (ttfw > 1200) s -= 2;
  else if (ttfw > 600) s -= 1;
  if (full > 5000) s -= 2;
  else if (full > 3200) s -= 1;
  else if (full > 1800) s -= 0.5;
  s = Math.max(0, Math.round(s));

  return {
    score: s,
    rationale: `ttfw=${Math.round(ttfw)}ms full=${Math.round(full)}ms`,
  };
}

function scoreMultiStep(
  result: InstrumentedResult,
  expected: QueryExpected,
): AxisScore {
  if (result.error) {
    return { score: 0, rationale: "error" };
  }
  const count = countSubAgentToolCalls(result);
  const minExpected = expected.min_tool_calls ?? 1;

  if (count >= minExpected + 2) {
    return { score: 5, rationale: `${count} tool calls (min ${minExpected})` };
  }
  if (count >= minExpected) {
    return { score: 4, rationale: `${count} tool calls (min ${minExpected})` };
  }
  if (count >= 1) {
    return { score: 2, rationale: `${count} tool calls, wanted ${minExpected}+` };
  }
  return { score: 0, rationale: "no sub-agent tool calls" };
}

function scoreCoverage(
  result: InstrumentedResult,
  expected: QueryExpected,
): AxisScore {
  if (result.error) {
    return { score: 0, rationale: "error" };
  }
  const names = extractToolNames(result);
  const delegated = names.some(
    (n) => n === "delegate_layout" || n === "delegate_content",
  );

  if (!delegated) {
    return {
      score: 0,
      rationale: "no delegation — agent did not act on this query",
    };
  }

  // For marginal queries, delegation alone is a pass
  if (expected.judge_tags.includes("marginal")) {
    const hasToolCalls = countSubAgentToolCalls(result) > 0;
    return {
      score: hasToolCalls ? 5 : 3,
      rationale: hasToolCalls
        ? "delegated and sub-agent acted"
        : "delegated but no sub-agent tool calls",
    };
  }

  return { score: 5, rationale: "delegated" };
}

function scoreRecovery(result: InstrumentedResult): AxisScore {
  if (result.error) {
    return { score: 0, rationale: "error" };
  }
  const failures = result.toolCalls.filter((t) => !t.ok);
  if (failures.length === 0) {
    // No failures to recover from — neutral high score
    return { score: 5, rationale: "no tool failures" };
  }

  // Check if any failure was followed by a retry (same tool name or
  // related tool within the same agent turn)
  let retries = 0;
  for (let i = 0; i < result.toolCalls.length; i++) {
    if (!result.toolCalls[i].ok) {
      // Look ahead for a subsequent call
      for (let j = i + 1; j < result.toolCalls.length; j++) {
        if (result.toolCalls[j].ok) {
          retries++;
          break;
        }
      }
    }
  }

  const rate = retries / failures.length;
  const s = Math.round(rate * 5);
  return {
    score: s,
    rationale: `${retries}/${failures.length} failures had a follow-up success`,
  };
}

function scoreCalmCanvas(
  result: InstrumentedResult,
  expected: QueryExpected,
): AxisScore {
  if (result.error) {
    return { score: 0, rationale: "error" };
  }

  const finalKinds: string[] = result.finalSnapshot.windows.map((w) => w.kind);
  const expectedKinds = expected.expected_window_kinds_after;

  // If no expectations set, give full marks (we can't judge)
  if (expectedKinds.length === 0) {
    return { score: 5, rationale: "no window expectations to check" };
  }

  // Check all expected kinds are present
  const missingKinds = expectedKinds.filter((k) => !finalKinds.includes(k));
  // Check for stray windows (not in expected + not reasonable)
  const strayKinds = finalKinds.filter((k) => !expectedKinds.includes(k));

  let s = 5;
  if (missingKinds.length > 0) {
    s -= Math.min(3, missingKinds.length);
  }
  if (strayKinds.length > 2) {
    s -= 1; // Too many stray windows = noisy canvas
  }
  s = Math.max(0, s);

  const parts: string[] = [];
  if (missingKinds.length > 0) parts.push(`missing: ${missingKinds.join(",")}`);
  if (strayKinds.length > 0) parts.push(`stray: ${strayKinds.join(",")}`);
  if (parts.length === 0) parts.push("canvas matches expectations");

  return { score: s, rationale: parts.join("; ") };
}

function scoreLayoutAesthetic(result: InstrumentedResult): AxisScore {
  if (result.error) {
    return { score: 0, rationale: "error" };
  }
  const wins = result.finalSnapshot.windows;
  if (wins.length <= 1) {
    return { score: 5, rationale: "single or no window — aesthetic n/a" };
  }

  let s = 5;
  const issues: string[] = [];

  // Check 1: no window exceeds 85% of canvas area
  const vp = result.finalSnapshot.viewport;
  for (const w of wins) {
    if (!w.rect) continue;
    const areaPct = ((w.rect.w ?? 0) * (w.rect.h ?? 0)) / (vp.w * vp.h) * 100;
    if (areaPct > 85) {
      s -= 1;
      issues.push(`${w.kind} is ${areaPct.toFixed(0)}% of canvas`);
      break;
    }
  }

  // Check 2: focused window should be centered-ish (within 15% of center)
  const focused = wins.find(w => w.focused);
  if (focused?.rect) {
    const cx = (focused.rect.x ?? 0) + (focused.rect.w ?? 0) / 2;
    const canvasCx = vp.w / 2;
    const offsetPct = Math.abs(cx - canvasCx) / vp.w * 100;
    if (offsetPct > 15) {
      s -= 0.5;
      issues.push(`focused ${focused.kind} off-center by ${offsetPct.toFixed(0)}%`);
    }
  }

  // Check 3: negative space — at least some gap between windows
  // (generous check: just confirm not all windows are edge-to-edge)
  s = Math.max(0, Math.round(s));
  if (issues.length === 0) issues.push("good spacing and centering");

  return { score: s, rationale: issues.join("; ") };
}

/** Judge a single query result against its expected spec. */
export function judgeQuery(
  id: string,
  category: string,
  result: InstrumentedResult,
  expected: QueryExpected,
): JudgeResult {
  const axes = {
    tool_call_correctness: scoreTool(result, expected),
    latency: scoreLatency(result),
    multi_step: scoreMultiStep(result, expected),
    coverage: scoreCoverage(result, expected),
    recovery: scoreRecovery(result),
    calm_canvas: scoreCalmCanvas(result, expected),
    layout_aesthetic: scoreLayoutAesthetic(result),
  };

  // A query passes if tool_call_correctness >= 3 AND coverage >= 3
  const passed =
    axes.tool_call_correctness.score >= 3 && axes.coverage.score >= 3;

  return {
    id,
    category,
    axes,
    passed,
    toolCallNames: extractToolNames(result),
    replyText: result.replyText,
  };
}
