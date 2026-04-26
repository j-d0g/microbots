# 01 — Pattern B: Vercel AI SDK parallel tool calls

Verifying the open question from `01-findings.md`:

> Does the Vercel AI SDK reliably issue parallel tool calls when prompted to,
> or does it serialise them?

Specifically: when the LLM emits multiple `tool_use` blocks in one assistant
message, does `streamText` invoke their `execute()` functions concurrently
(Promise.all-style) or sequentially?

## Verdict

**Pattern B works out of the box. No code change required to `route.ts`.**

- Vercel AI SDK `streamText` fires tool `execute()` calls concurrently the
  moment each `tool-call` chunk arrives in the stream. It does **not** await
  the previous tool's result before starting the next one.
- Anthropic's Messages API allows parallel tool use by default. The opt-out
  is `disable_parallel_tool_use: true` (under `tool_choice`), which the
  `@ai-sdk/anthropic` provider never sets.
- Our `route.ts` already passes `tools` without a custom `toolChoice`, which
  serialises to `tool_choice: { type: 'auto' }` in the wire payload — exactly
  the shape that allows multiple `tool_use` blocks in one assistant turn.

The remaining variable is **whether Claude actually decides to fan out**.
That is an LLM-behaviour question (system prompt + user prompt), not an SDK
or transport question. Lane D's prompt nudge will handle it.

## Versions in use

From `agent/harness/frontend/package.json` and the resolved `node_modules`:

| Package | Pinned | Resolved |
|---|---|---|
| `ai` | `^4.0.0` | `4.3.19` |
| `@ai-sdk/anthropic` | `^1.0.0` | `1.2.12` |
| `@ai-sdk/react` | `^1.0.0` | `1.2.12` |

## Evidence

### 1. SDK source: `streamText` fires executes without awaiting

`node_modules/ai/dist/index.mjs` line 4982 — `runToolsTransformation`,
which is what `streamText` uses to process each chunk of the model stream.
For each incoming `tool-call` chunk it does:

```js
case "tool-call": {
  // ...
  if (tool2.execute != null) {
    const toolExecutionId = generateId();
    outstandingToolResults.add(toolExecutionId);
    recordSpan({
      // ...
      fn: async (span) => tool2.execute(toolCall.args, {
        toolCallId: toolCall.toolCallId,
        messages,
        abortSignal
      }).then(
        (result) => {
          toolResultsStreamController.enqueue({ ...toolCall, type: "tool-result", result });
          outstandingToolResults.delete(toolExecutionId);
          attemptClose();
          // ...
        },
        (error) => { /* error path */ }
      )
    });
  }
  break;
}
```
(`node_modules/ai/dist/index.mjs:5053-5135`)

Key shape: the per-chunk transform calls `tool2.execute(...)` and chains
`.then(...)` — it does **not** `await` the call. The returned promise is
tracked via `outstandingToolResults` and `attemptClose()`, so the stream
stays open until all in-flight tool executions resolve, but each new
`tool-call` chunk that arrives kicks off another concurrent execute.

When Anthropic's stream emits N `tool_use` blocks back-to-back in one
assistant message, the SDK kicks off N concurrent `execute()` calls.

(For completeness: the non-streaming `generateText` path also runs tools
in parallel — `executeTools` at `node_modules/ai/dist/index.mjs:4532` uses
`await Promise.all(toolCalls.map(...))`.)

### 2. SDK source: Anthropic provider does not pass `disable_parallel_tool_use`

`node_modules/@ai-sdk/anthropic/dist/index.mjs` `prepareTools()` at line 43
— the only `tool_choice` shapes the provider produces are:

- `undefined` (when `toolChoice` is unset) — parallel-allowed default
- `{ type: 'auto' }` (toolChoice `'auto'`) — parallel-allowed
- `{ type: 'any' }` (toolChoice `'required'`) — parallel-allowed
- `{ type: 'tool', name }` (toolChoice `'tool'`) — single tool only

`grep -r 'disable_parallel_tool_use|disableParallelToolUse'` against the
provider's `dist/` returns zero matches. The flag is never sent.

### 3. Anthropic API default: parallel tool use is on

[Anthropic — Parallel tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/parallel-tool-use):

> By default, Claude may use multiple tools to answer a user query. You can
> disable this behavior by setting `disable_parallel_tool_use=true` when
> tool_choice type is `auto`, which ensures that Claude uses **at most one**
> tool.

The flag is opt-out, not opt-in. The Vercel SDK never opts out, so we get
the default (parallel allowed).

### 4. Live wire-payload inspection

Running a probe against the production model emitted a 400 ("credit balance
too low") before any tokens streamed, but the failure surfaced the literal
request body the SDK was about to POST to `https://api.anthropic.com/v1/messages`:

```js
requestBodyValues: {
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  temperature: 0,
  tools: [ [Object], [Object] ],
  tool_choice: { type: 'auto' },   // <-- no disable_parallel_tool_use
  stream: true,
  // ...
}
```

That's precisely the body shape Anthropic's docs identify as parallel-allowed.

### 5. Empirical SDK probe (mock model, no API needed)

`/tmp/pattern_b_sdk_probe.mjs` builds a `MockLanguageModelV1` whose first
streamed step contains two `tool-call` chunks in one turn (mimicking what
Anthropic emits when it decides to fan out). Each tool's `execute()` does:

```js
record(name, "enter");
await sleep(1000);
record(name, "exit");
```

If the SDK awaited tool A before starting tool B, total wall time would
be ~2 s and `b.enter` would be `> a.exit`. If parallel, total wall time
would be ~1 s and `b.enter` would be `< a.exit`.

Run output:

```
[t+0]    tool_a:enter
[t+4]    tool_b:enter         <-- started before tool_a finished
[t+1003] tool_a:exit
[t+1004] tool_b:exit

a:  1003 ms
b:  1000 ms
gap a.enter -> b.enter: 4 ms
b.enter < a.exit? true  (true => parallel)

VERDICT: PARALLEL
```

Definitive. Both `execute()` invocations were live concurrently; the SDK
did not serialise them.

## Is `route.ts` already configured for parallel tool calls?

**Yes, no change needed.** `agent/harness/frontend/app/api/chat/route.ts`
calls `streamText({ model, system, messages, maxSteps: 8, tools, ... })`
with no `toolChoice` override and no `experimental_*` flags that would
affect tool execution dispatch. That is the parallel-by-default path.

(The one client-resolved tool — `ask_user`, defined without `execute` —
is unrelated. The SDK does not invoke `execute` for it; the client UI
resolves it. That coexists fine with parallel server-side tool execution.)

## If it didn't work — the diff that would be needed (NOT NEEDED, included for completeness)

Hypothetical only. We confirmed nothing needs to change. If the SDK had
defaulted to serial and exposed an `experimental_continueSteps` /
`toolChoice` flag, the diff would look like this — but, again, **do not
apply** this:

```diff
--- a/agent/harness/frontend/app/api/chat/route.ts
+++ b/agent/harness/frontend/app/api/chat/route.ts
@@ -57,7 +57,8 @@
     const result = streamText({
       model: anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6"),
       system: SYSTEM_PROMPT,
       messages,
       maxSteps: 8,
-      tools,
+      tools,
+      toolChoice: "auto", // (already the default; redundant but explicit)
       onFinish: async () => {
```

Even this is a no-op given the current SDK behaviour. The actual diff
budget for Pattern B is 0 lines in `route.ts`.

## Gotchas

1. **LLM behaviour ≠ SDK behaviour.** The SDK is willing to run N tool
   executes in parallel. Claude has to be willing to *emit* N `tool_use`
   blocks in one message in the first place. Claude 4 / Sonnet 4 family
   do this well by default for clearly-parallel queries; weaker models or
   ambiguous prompts often serialise across turns instead. Lane D's
   system-prompt nudge ("when each item needs full isolation, issue
   parallel `run_code` calls") is what actually drives Pattern B.

2. **Tool-result message shape matters for follow-on turns.** Per the
   Anthropic parallel-tool-use docs, all `tool_result` blocks for a
   parallel batch must come back in a *single* user message, not split
   into separate user messages. The Vercel AI SDK already does this
   correctly when `streamText` aggregates results before the next step;
   `useChat` on the frontend renders each tool invocation as a separate
   UI block but the wire payload back to Anthropic is single-message.
   Don't manually rewrite history in a way that splits these.

3. **`maxSteps: 8` is the agent-loop ceiling, not a parallel-call cap.**
   One step can contain unlimited parallel tool calls (subject to
   Anthropic's max output tokens and the model's discretion). Pattern B
   with N=10 fits in one step — no `maxSteps` bump needed.

4. **Workflows concurrency cap dominates.** Pattern B at N=50 will hit
   the 20-concurrent-Workflows-runs free cap on Render Hobby before it
   hits anything in the Vercel SDK. That's a substrate limit, not an
   SDK limit. See `01-findings.md` "Concurrency cost reality".

5. **Streaming order is not a serialisation signal.** The SDK emits
   `tool-call`, `tool-call`, `tool-result`, `tool-result` chunks in
   roughly that order on the wire because it streams calls before
   results. That can look serial in the UI even when the underlying
   `execute()` invocations overlapped. Trust timestamps (or the probe
   above), not stream-order intuition.

## Repro

Source-only checks (no API key required):

```bash
cd agent/harness/frontend
grep -n 'tool2.execute' node_modules/ai/dist/index.mjs        # streamText fire-and-forget
grep -n 'await Promise.all' node_modules/ai/dist/index.mjs    # generateText parallel
grep -rn 'disable_parallel_tool_use' node_modules/@ai-sdk/anthropic/dist/  # zero matches expected
```

SDK probe (no API key required, ~1.5s):

```bash
cd agent/harness/frontend
node /tmp/pattern_b_sdk_probe.mjs
# Expect: VERDICT: PARALLEL
```

Live probe (requires Anthropic credit; just shows the wire payload if
credit is depleted):

```bash
cd agent/harness/frontend
export $(grep -v '^#' .env.local | xargs)
ANTHROPIC_MODEL="claude-sonnet-4-6" node /tmp/pattern_b_probe.mjs
# Expect: VERDICT: PARALLEL (or wire-payload dump showing tool_choice: auto
# with no disable_parallel_tool_use field if credit is depleted).
```
