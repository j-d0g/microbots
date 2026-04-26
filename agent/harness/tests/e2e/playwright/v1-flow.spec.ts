import { test, expect, Page, Locator } from "@playwright/test";

/**
 * V1 builder flow — deterministic 6-turn scripted scenario.
 *
 * Maps 1:1 to "Agent C" in
 *   agent/scratchpad/p2-v1-tools/plan/01-implementation.md
 *
 * Turn-by-turn:
 *   1. "Build me a hello-world that prints the date."
 *      → expect find_examples and/or run_code, then save_workflow.
 *   2. "Show me what I just saved."
 *      → expect view_workflow, with code field present in the result.
 *   3. "Run it again."
 *      → expect run_workflow, with stdout/result/error keys in result.
 *   4. "What have I built?"
 *      → expect list_workflows with workflows array (count >= 1).
 *   5. "What did I work on related to slack?"
 *      → expect search_memory was called. Tolerant of stub vs wired
 *        backend — only asserts the contract shape, not the result count.
 *
 * Assertions key on tool-call sequencing + result-dict shape, NOT on
 * the agent's natural-language replies (those vary across runs / models).
 *
 * Each turn waits for the previous ones to fully resolve before sending
 * the next, because the agent's later decisions depend on the earlier
 * tool results being on the wire.
 */

// ---- helpers ----

/** All tool-invocation badges currently rendered on the page, in DOM order. */
function toolInvocations(page: Page): Locator {
  return page.getByTestId("tool-invocation");
}

/** Filter to invocations that have completed (state="result"). */
function completedInvocations(page: Page, toolName: string): Locator {
  return page.locator(
    `[data-tool-name="${toolName}"][data-tool-state="result"]`,
  );
}

/** Wait until at least one invocation of `toolName` has reached state="result". */
async function waitForCompleted(
  page: Page,
  toolName: string,
  opts: { timeout?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 180_000;
  await expect(async () => {
    const count = await completedInvocations(page, toolName).count();
    expect(count).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout });
}

/**
 * Read back the JSON shown in the `<details><summary>result</summary>...`
 * pre-block of the *first* completed invocation of `toolName`. The chat
 * UI stringifies the tool result with `JSON.stringify(result, null, 2)`,
 * so this is reliable.
 *
 * The `<details>` element is collapsed by default — `innerText` returns
 * empty for collapsed content. We pull the raw text via `textContent`
 * (which ignores rendered visibility) and grab the last <pre> inside
 * the block (page.tsx renders args first, then result).
 *
 * The Vercel AI SDK forwards MCP tool results in their raw envelope:
 *   { content: [{ type: "text", text: "<stringified-json>" }], isError }
 * We auto-unwrap that to the inner dict so callers can assert on the
 * tool's actual {url, slug, code, ...} shape.
 */
async function readToolResult(
  page: Page,
  toolName: string,
): Promise<Record<string, unknown>> {
  const block = completedInvocations(page, toolName).first();
  // The result <pre> is the last <pre> in the block; args (if shown) is first.
  const pre = block.locator("pre").last();
  const raw = (await pre.textContent()) ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `tool-invocation[${toolName}] result was not valid JSON:\n${raw}`,
    );
  }
  // Unwrap MCP-style envelopes so callers see the tool's own dict shape.
  if (
    parsed &&
    typeof parsed === "object" &&
    "content" in parsed &&
    Array.isArray((parsed as { content?: unknown[] }).content)
  ) {
    const content = (parsed as { content: Array<Record<string, unknown>> }).content;
    const textPart = content.find((c) => c?.type === "text" && typeof c.text === "string");
    if (textPart && typeof textPart.text === "string") {
      try {
        const inner = JSON.parse(textPart.text);
        if (inner && typeof inner === "object") {
          return inner as Record<string, unknown>;
        }
      } catch {
        // Fall through to returning the envelope itself if inner parse fails.
      }
    }
  }
  if (parsed && typeof parsed === "object") {
    return parsed as Record<string, unknown>;
  }
  throw new Error(
    `tool-invocation[${toolName}] result was not an object:\n${raw}`,
  );
}

/** Fill the chat input and click submit. */
async function send(page: Page, message: string): Promise<void> {
  // Wait for the input to be re-enabled between turns (the chat shell
  // disables it while a stream is in flight).
  await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 240_000 });
  await page.getByTestId("chat-input").fill(message);
  await page.getByTestId("chat-submit").click();
}

/** Wait for the chat to settle (input re-enabled, no "thinking…"). */
async function waitForTurnDone(page: Page): Promise<void> {
  await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 240_000 });
}

// ---- the test ----

test("V1 builder flow — find/run/save → view → run → list → search", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /microbot harness/i }),
  ).toBeVisible();
  await expect(page.getByTestId("chat-input")).toBeVisible();

  const errorPane = page.getByTestId("chat-error");

  // ============================================================
  // Turn 1 — "Build me a hello-world that prints the date."
  //   → expect find_examples and/or run_code, then save_workflow.
  // ============================================================
  await send(
    page,
    'Build me a hello-world workflow that prints the current date. ' +
      'Use find_examples first to look for a template, then run it once ' +
      "with run_code to verify it works, then save it as " +
      '"hello-date" with save_workflow. Keep it short.',
  );

  // save_workflow is the load-bearing call for this turn.
  await waitForCompleted(page, "save_workflow", { timeout: 240_000 });

  // At least one of {find_examples, run_code} must have completed before
  // save_workflow — the spec allows either or both as the "discovery"
  // step. Check by count rather than ordering, because the agent may
  // interleave them.
  const findExamplesCount = await completedInvocations(page, "find_examples").count();
  const runCodeCount = await completedInvocations(page, "run_code").count();
  expect(
    findExamplesCount + runCodeCount,
    "expected at least one find_examples or run_code call before save_workflow",
  ).toBeGreaterThanOrEqual(1);

  // save_workflow result must have the documented shape.
  const saveResult = (await readToolResult(page, "save_workflow")) as Record<
    string,
    unknown
  >;
  expect(saveResult, "save_workflow result is an object").toBeTruthy();
  expect(saveResult).toHaveProperty("url");
  expect(saveResult).toHaveProperty("saved_to");
  expect(saveResult).toHaveProperty("bytes");
  expect(typeof saveResult.url).toBe("string");
  expect(String(saveResult.url)).toMatch(/\/workflows\/[a-z0-9-]+/);

  await waitForTurnDone(page);
  await expect(errorPane).toHaveCount(0);

  // ============================================================
  // Turn 2 — "Show me what I just saved."
  //   → expect view_workflow with {code, slug} in the result.
  // ============================================================
  await send(
    page,
    "Show me what I just saved. Use view_workflow on the workflow you " +
      "just created (its name is hello-date).",
  );

  await waitForCompleted(page, "view_workflow", { timeout: 180_000 });
  const viewResult = (await readToolResult(page, "view_workflow")) as Record<
    string,
    unknown
  >;
  expect(viewResult).toBeTruthy();
  // Either success-shape {name, slug, code, bytes} or {error: ...}.
  // For the happy path we expect success.
  expect(viewResult, "view_workflow returned error: " + JSON.stringify(viewResult))
    .not.toHaveProperty("error");
  expect(viewResult).toHaveProperty("slug");
  expect(viewResult).toHaveProperty("code");
  expect(typeof viewResult.code).toBe("string");
  expect(String(viewResult.code).length).toBeGreaterThan(0);

  await waitForTurnDone(page);
  await expect(errorPane).toHaveCount(0);

  // ============================================================
  // Turn 3 — "Run it again."
  //   → expect run_workflow with {result, stdout, stderr, error} keys.
  // ============================================================
  await send(
    page,
    "Run it again — use run_workflow on hello-date. I want to see the " +
      "stdout.",
  );

  await waitForCompleted(page, "run_workflow", { timeout: 240_000 });
  const runResult = (await readToolResult(page, "run_workflow")) as Record<
    string,
    unknown
  >;
  expect(runResult).toBeTruthy();
  // Contract shape mirrors run_code: {result, stdout, stderr, error}.
  // All four keys must be present (any can be null/empty-string).
  for (const key of ["result", "stdout", "stderr", "error"]) {
    expect(runResult, `run_workflow result missing key '${key}'`).toHaveProperty(key);
  }

  await waitForTurnDone(page);
  await expect(errorPane).toHaveCount(0);

  // ============================================================
  // Turn 4 — "What have I built?"
  //   → expect list_workflows with at least one entry.
  // ============================================================
  await send(
    page,
    "What have I built? Use list_workflows to enumerate everything saved " +
      "so far.",
  );

  await waitForCompleted(page, "list_workflows", { timeout: 180_000 });
  const listResult = (await readToolResult(page, "list_workflows")) as Record<
    string,
    unknown
  >;
  expect(listResult).toBeTruthy();
  expect(listResult).toHaveProperty("workflows");
  expect(listResult).toHaveProperty("count");
  expect(Array.isArray(listResult.workflows)).toBe(true);
  const workflows = listResult.workflows as Array<Record<string, unknown>>;
  expect(workflows.length, "expected at least one saved workflow").toBeGreaterThanOrEqual(1);
  // Each entry has {slug, summary, bytes, modified}.
  for (const entry of workflows) {
    expect(entry).toHaveProperty("slug");
    expect(entry).toHaveProperty("summary");
    expect(entry).toHaveProperty("bytes");
    expect(entry).toHaveProperty("modified");
  }
  // The hello-date workflow we just saved must appear in the list.
  const slugs = workflows.map((w) => String(w.slug));
  expect(slugs).toContain("hello-date");

  await waitForTurnDone(page);
  await expect(errorPane).toHaveCount(0);

  // ============================================================
  // Turn 5 — "What did I work on related to slack?"
  //   → expect search_memory invocation. Tolerant of stub/wired —
  //     do NOT assert on results count.
  // ============================================================
  await send(
    page,
    "What did I work on related to slack? Use search_memory to check.",
  );

  await waitForCompleted(page, "search_memory", { timeout: 180_000 });
  const searchResult = (await readToolResult(page, "search_memory")) as Record<
    string,
    unknown
  >;
  expect(searchResult).toBeTruthy();
  // Contract shape (stub-or-wired tolerant): {results, query, scope}.
  expect(searchResult).toHaveProperty("results");
  expect(searchResult).toHaveProperty("query");
  expect(searchResult).toHaveProperty("scope");
  expect(Array.isArray(searchResult.results)).toBe(true);
  // `scope` defaults to "all" when omitted; if the agent passes one
  // explicitly it should still be a string.
  expect(typeof searchResult.scope).toBe("string");
  // `query` should be a string and non-empty (the agent should have
  // actually given search_memory a query, not called it bare).
  expect(typeof searchResult.query).toBe("string");
  expect(String(searchResult.query).length).toBeGreaterThan(0);

  await waitForTurnDone(page);
  await expect(errorPane).toHaveCount(0);

  // ============================================================
  // Final invariants across the whole flow.
  // ============================================================

  // We expect each of the five V1-relevant tools to have been called
  // at least once across the conversation.
  for (const tool of [
    "save_workflow",
    "view_workflow",
    "run_workflow",
    "list_workflows",
    "search_memory",
  ]) {
    const n = await completedInvocations(page, tool).count();
    expect(n, `expected at least one completed call to ${tool}`).toBeGreaterThanOrEqual(1);
  }

  // No error pane appeared in any turn.
  await expect(errorPane).toHaveCount(0);

  // Total invocations should be modest — sanity check we didn't enter
  // a loop. Allow up to 30 across the whole flow (covers retries,
  // multiple list/view/run calls if the agent double-checks).
  const total = await toolInvocations(page).count();
  expect(total, "tool-invocation count looks like a runaway loop").toBeLessThanOrEqual(30);
});
