# Pydantic-AI + Logfire Substrate for microbots

> Research agent R7 — overnight ralph loop. Sources: pydantic.dev/docs/ai (v1.86.1, 2026-04-23), pydantic.dev/docs/logfire, github.com/pydantic/pydantic-ai. Researched 2026-04-24.

## TL;DR

pydantic-ai (v1.86.1) is the right substrate for the System 2 daytime loop: Pydantic-typed tools, multi-step `Agent.iter()` graphs, native streaming, and one-line Logfire auto-instrumentation that captures every LLM + tool call. **Anthropic OAuth is NOT natively supported** — only `api_key` or cloud-provider clients (Bedrock, Vertex, Foundry). To bill against the founder's Claude subscription, route through a custom `AsyncClient` with `Authorization: Bearer <oat-token>` injected via `AnthropicProvider(http_client=…)` (gray-area per Anthropic ToS). Multi-agent: prefer **agent-as-tool delegation** with shared `usage=ctx.usage`. System 1 overnight consolidator can drop to raw SDK when needed.

---

## pydantic-ai

### MVP agent loop

```python
from pydantic_ai import Agent, RunContext
from pydantic import BaseModel

class SearchArgs(BaseModel):
    query: str
    limit: int = 5

agent = Agent(
    'anthropic:claude-sonnet-4-6',
    deps_type=AppDeps,                  # DI container (db, http, settings)
    output_type=str,                    # or a Pydantic model for structured out
    instructions='You are microbots.',
)

@agent.tool
async def search(ctx: RunContext[AppDeps], args: SearchArgs) -> list[dict]:
    """Search the index."""
    return await ctx.deps.search.query(args.query, args.limit)

# one-shot
result = await agent.run('find recent runs', deps=deps)
print(result.output, result.usage())

# multi-turn
r2 = await agent.run('and the failures?', deps=deps,
                     message_history=result.new_messages())
```

Tools auto-derive their JSON schema from the function signature / Pydantic model. `RunContext` is the dep-injection handle. `result.new_messages()` is the message-history surface for chat threads.

### Run modes (pick per call site)

| Method | Use for |
|---|---|
| `agent.run(...)` | async one-shot, full result |
| `agent.run_sync(...)` | scripts, tests |
| `agent.run_stream(...)` | streaming text/structured output to UI |
| `agent.run_stream_events(...)` | fine-grained `PartStartEvent` / `PartDeltaEvent` |
| `agent.iter(...)` | node-by-node graph walk (intercept tool calls, inject state) |

### Tools

- `@agent.tool` (with `RunContext`) for tools that need deps.
- `@agent.tool_plain` for pure functions.
- `@agent.tool(retries=2)` for per-tool retries on validation failure.
- Args can be a Pydantic model or typed kwargs — schema is generated either way.
- Validation errors are fed back to the model as a tool-call retry (built-in self-correction loop).

### Streaming + structured outputs

Two layers worth knowing for the chat UI:

1. **Vercel AI Adapter (recommended for FastAPI chat UIs)** — ships in `pydantic_ai.ui.vercel_ai`. One-liner:
   ```python
   from pydantic_ai.ui.vercel_ai import VercelAIAdapter

   @app.post('/chat')
   async def chat(req: Request):
       return await VercelAIAdapter.dispatch_request(req, agent=agent)
   ```
   Returns SSE in the Vercel AI SDK protocol — works directly with `useChat()` in a Next.js client.
2. **Manual** — `agent.run_stream_events()` yields typed deltas; wrap in `StreamingResponse` if you need a custom SSE shape.

Structured outputs: set `output_type=MyModel`. The model gets a forced tool-call to return validated JSON; `result.output` is a fully-typed instance. With `stream_output()` you get partial Pydantic models as they fill in.

### Multi-agent / sub-agent dispatch

Three patterns; one is the right default for microbots.

**(1) Agent delegation — agent-as-tool (DEFAULT for microbots sub-agents):**
```python
@orchestrator.tool
async def consult_researcher(ctx: RunContext[Deps], topic: str) -> str:
    r = await researcher_agent.run(topic, deps=ctx.deps, usage=ctx.usage)
    return r.output
```
The `usage=ctx.usage` pass-through is critical — it unifies token accounting across nested agents and Logfire traces. This is what microbots wants for "dispatch a sub-agent." No graph required.

**(2) Programmatic hand-off:** orchestration code calls `agent_a.run() → agent_b.run()` in sequence with a shared `RunUsage`. Use this for fixed pipelines (e.g. plan → execute → verify) where the path is deterministic.

**(3) Graph (`pydantic_graph`):** typed state machine with explicit nodes. Real but heavy — only worth it when control flow has loops/branches you can't express as tool calls. For a hackathon, skip unless the System 1 overnight consolidator wants explicit checkpointable nodes.

> Recommendation for microbots: **(1) for sub-agent dispatch, (2) for the daytime loop's high-level planner/executor split, (3) only if you need durable graph state.**

### Escape hatch — raw Anthropic SDK

You can mix freely. Either:
- Pass an existing `AsyncAnthropic` client into `AnthropicProvider(anthropic_client=…)` — pydantic-ai uses it for agent calls while you reuse the same client for ad-hoc raw `messages.create(...)` calls in the System 1 consolidator.
- Or just `import anthropic` separately. Logfire auto-instrumentation covers the SDK too via OpenTelemetry, so traces still land in the same dashboard.

---

## Logfire

### Setup (3 lines)

```python
import logfire
logfire.configure()                  # reads LOGFIRE_TOKEN env
logfire.instrument_pydantic_ai()     # global; or pass an Agent for per-instance
logfire.instrument_fastapi(app)      # request spans + validation errors
```

That's the whole deal. `logfire auth` for local dev creds; `LOGFIRE_TOKEN` write token for prod.

### What auto-instrumentation captures

`instrument_pydantic_ai()` emits OTEL spans for:
- Each agent run (root span with `agent_name`, model, system prompt id).
- Each LLM call (provider, model, prompt, response, **token usage + cost**).
- Each tool call (name, args as validated by Pydantic, return value, retries).
- Validation failures and self-correction retries.
- Streaming chunk timing.

`instrument_fastapi(app)` adds:
- Request spans with parsed args (`fastapi.arguments.values`) and validation errors.
- Timing split between argument parsing and endpoint body.
- Trace context propagation so a `/chat` request span is the parent of the agent run.

### Custom spans (when needed)

```python
with logfire.span('consolidate-overnight', batch_id=bid):
    ...
logfire.info('snapshot saved', count=n)
```

Use these for:
- The System 1 overnight loop's batch boundaries.
- DB writes / vector-store ops not already covered by an instrumentation.
- Business-meaningful units (one "microbot turn") so the dashboard groups by them.

### Dashboards

Logfire ships with prebuilt LLM views: conversation panel (full prompt/response per turn), token cost + latency by model, tool-call inspector. SQL queries over spans for ad-hoc analysis. Live tail mode for the overnight loop.

### Gotchas

- Never expose `LOGFIRE_TOKEN` in browser code (it's a write token).
- `request_attributes_mapper` must not mutate inputs.
- Logfire is OTEL — anything OTEL-instrumented (httpx, asyncpg, Anthropic SDK) auto-joins the trace tree.

---

## Anthropic OAuth status — short answer: no

pydantic-ai (as of v1.86.1) supports Anthropic via:
- API key (`ANTHROPIC_API_KEY` or `AnthropicProvider(api_key=…)`).
- `AsyncAnthropicBedrock`, `AsyncAnthropicVertex`, Foundry (Entra ID).
- A **custom `httpx.AsyncClient`** passed to `AnthropicProvider(http_client=…)`.

There is **no native OAuth flow / `sk-ant-oat01-` token handling**. The only way to attempt subscription-billed calls is to attach an `Authorization: Bearer <oat-token>` header via the custom client. Caveats:
- Anthropic's stated policy (Feb 2026 ToS clarification + the OpenClaw incident) is that OAuth tokens are valid only inside Claude Code / claude.ai. Third-party use violates Consumer ToS; calls land in an empty `extra_usage` billing pool.
- Tokens expire and need refresh; pydantic-ai won't help with rotation.
- For a hackathon demo it may work; for production / sponsored billing, prefer the API key against the founder's org account.

If you want to push it: wrap a custom client that injects `ANTHROPIC_AUTH_TOKEN`-style bearer auth and refreshes on 401. Treat it as a known-fragile escape hatch and instrument it with explicit Logfire spans so the failure mode is visible.

---

## Recommended microbots agent loop shape

```python
# bootstrap (once, at FastAPI startup)
import logfire
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.anthropic import AnthropicProvider

logfire.configure()
logfire.instrument_pydantic_ai()
logfire.instrument_fastapi(app)

model = AnthropicModel(
    'claude-sonnet-4-6',
    provider=AnthropicProvider(api_key=settings.anthropic_api_key),
    # swap to http_client=oauth_client for the founder-billing experiment
)

orchestrator = Agent(
    model,
    deps_type=AppDeps,
    instructions=ORCHESTRATOR_PROMPT,
)

researcher = Agent(model, deps_type=AppDeps, instructions=RESEARCHER_PROMPT)
executor   = Agent(model, deps_type=AppDeps, instructions=EXECUTOR_PROMPT)

@orchestrator.tool
async def research(ctx: RunContext[AppDeps], topic: str) -> str:
    r = await researcher.run(topic, deps=ctx.deps, usage=ctx.usage)
    return r.output

@orchestrator.tool
async def execute(ctx: RunContext[AppDeps], plan: Plan) -> ExecResult:
    r = await executor.run(plan.json(), deps=ctx.deps, usage=ctx.usage,
                           output_type=ExecResult)
    return r.output

# FastAPI chat endpoint — Vercel AI SDK protocol, streams to UI
from pydantic_ai.ui.vercel_ai import VercelAIAdapter

@app.post('/chat')
async def chat(request: Request):
    return await VercelAIAdapter.dispatch_request(request, agent=orchestrator)

# System 1 overnight: raw SDK is fine; same Logfire trace tree
async def consolidate_overnight(batch):
    with logfire.span('consolidate-overnight', batch_id=batch.id):
        client = AsyncAnthropic()  # auto-traced via OTEL
        msg = await client.messages.create(model='claude-haiku-4-6', ...)
        ...
```

### Quick wins

- Define every tool input as a Pydantic model — validation retries are free.
- Always pass `usage=ctx.usage` when delegating; otherwise the dashboard double-counts.
- Use `agent.iter()` in tests to assert on the node sequence (deterministic harness verification).
- Use `output_type=` for any tool that hands data to other system components — turns the LLM into a typed function.
- Wrap the overnight consolidator in one `logfire.span()` per batch so dashboards group by run.

### Known gotchas (FastAPI)

- `logfire.configure()` must run before `Agent(...)` is instantiated for instrumentation to attach.
- Don't share an `Agent` across event loops in tests — recreate per test.
- `VercelAIAdapter` expects the Vercel AI SDK request shape; if rolling your own UI protocol, use `agent.run_stream_events()` + a custom SSE encoder.
- Streaming + structured output: partial models can fail validation mid-stream; `stream_output()` yields valid partial models, `stream_text()` is safer for free-text.

---

**Bottom line:** pydantic-ai + Logfire is a one-evening-of-setup substrate that gives microbots tool typing, multi-agent dispatch, streaming, and end-to-end traces. The only missing piece is first-class Anthropic OAuth — work around it with a custom `http_client` if you must, but plan to fall back to API key auth for the demo.
