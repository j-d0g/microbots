# 05 — Tool schemas (for UI mocking)

For a designer / frontend friend mocking the harness UI without running the code.

## Figma boards

| Board | Purpose | URL |
|---|---|---|
| Reference (Cody / maximalist baseline) | The 17-tool agent the v0 cuts down from. Shows the full surface to compare against. | https://www.figma.com/board/FTupkkCSesUX3heUvxCNHg |
| microbots v0 (lean) | The 4-tool harness being built. | https://www.figma.com/board/QaFaWoBRqd1aoOrrTXSgTL |

## The 4 tools

### 1. `run_code`

```ts
input:  { code: string; args?: Record<string, any> }
output: { result: any | null; stdout: string; stderr: string; error: string | null }
```

Use when: compute, fetch, parse, anything mechanical.
Latency: ~5–10s (cold Render Workflow runner).
Pre-imported libs: `httpx`, `requests`, `beautifulsoup4`.

### 2. `find_examples`

```ts
input:  { query: string }
output: {
  matches: Array<{ id: string; title: string; description: string; tags: string[]; code: string }>;
  count: number;   // ≤ 3
}
```

Use when: agent suspects a relevant template exists. Substring match over title + description + tags.

### 3. `save_workflow`

```ts
input:  { name: string; code: string }
output: { url: string; saved_to: string; bytes: number }
```

Use when: user wants to persist / promote / publish. v0 returns mock URL (`https://example.com/workflows/<slug>`); v2 returns real deployed URL.

### 4. `ask_user`  *(client-resolved)*

```ts
input:  { question: string; options?: string[] }   // options up to 5
output: string                                      // user's answer
```

Use when: BEFORE destructive actions (sending messages, deletes, paid API). Frontend renders a UI prompt; answer flows back through the tool result.

## UI states (what to mock)

### Tool-call badge (run_code, find_examples, save_workflow)

Three states per invocation:

```
state="partial-call"  →  args streaming, no result yet
state="call"          →  args complete, executing
state="result"        →  done, result available
```

Visual:

```
┌─────────────────────────────────────┐
│  🔧 run_code (call)                 │
│  ▸ args { code: "print(7**2)" }     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  🔧 run_code (result)               │
│  ▸ args { code: "print(7**2)" }     │
│  ▸ result { stdout: "49\n", ... }   │
└─────────────────────────────────────┘
```

Color: pale blue background (`#eef`), `#cce` border, monospace font for args/result.

### ask_user inline prompt

Rendered inside the assistant message as a yellow card:

```
┌─────────────────────────────────────────────┐
│  ❓ Are you sure you want to delete /tmp?   │
│  [ yes ]  [ no ]                            │
└─────────────────────────────────────────────┘
                                              ← if options[]

┌─────────────────────────────────────────────┐
│  ❓ What should I name the workflow?        │
│  [ ___________________________ ] [ send ]   │
└─────────────────────────────────────────────┘
                                              ← if no options
```

Color: pale yellow (`#fef9e7`), `#f0d870` border. After user answers, card collapses to a regular tool-result badge.

## Message structure

Each assistant message has interleaved parts:

```ts
type Part =
  | { type: "text"; text: string }
  | { type: "tool-invocation"; toolInvocation: { toolName, toolCallId, state, args, result? } };

type Message = { id: string; role: "user" | "assistant"; parts: Part[] };
```

Render parts in order. The LLM weaves text + tool calls naturally:
> "Let me try this" → run_code(...) → "that gave 49" → run_code(...) → "final answer: ..."

## Example flow

User: *"compute the square of 7"*

```
[user]
  text: "compute the square of 7"

[assistant]
  text: "I'll run that."
  tool-invocation: run_code, args={code:"print(7**2)"}, state=result, result={stdout:"49\n"}
  text: "49"
```

## Source files (if friend wants the truth)

- `agent/harness/frontend/app/page.tsx` — current chat UI (reference for badge styling)
- `agent/harness/frontend/app/api/chat/route.ts` — tool definitions consumed from MCP
- `agent/harness/mcp/server.py` — MCP-side tool implementations

This doc is the contract. Mocks against it will work.
