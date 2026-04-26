# Render — sponsor talking points

**Commitment (locked-in):** We are going with Render and leaning into **parallel fan-out, task chaining, and recomposable swarm** as the core differentiating story. Render Workflows is the substrate; in-process execution on the MCP Web Service handles the interactive chat path. Two-tier architecture, both tiers on Render hardware.

This document is the canonical source for the Render section of the pitch deck and the "why Render" answer to judges. Everything below is grounded in research or measurement.

---

## Headline pitch line

> **"The agent that thinks in parallel containers."**
>
> Render Workflows isn't just where our code runs — it's the agent's *parallel-thinking primitive*. When the LLM decides a task is parallelizable, it calls `swarm()`. The platform spawns N isolated containers, each running its own Claude reasoning call, and reduces the results. You watch it happen on Render's dashboard during the demo.

---

## What we're showcasing (in priority order)

### 1. Parallel fan-out as an agent primitive

The agent has TWO execution modes it picks between:

```python
run_local(code)               # exec() in MCP service, ~10ms
swarm(prompt, fan_out=N)      # Render Workflow fans out N parallel
                              # Claude-powered sub-tasks, reduces
```

The LLM decides per-task. Demo moment: 10 (or 50) containers visible in the Render dashboard, each running an independent agent reasoning call. Judges literally watch their own product working under load.

### 2. Task chaining as a programming model

Render's standout feature: `await child_task(x)` from inside a parent task transparently spawns a fresh isolated container for `child_task`. The code reads like ordinary async Python; the runtime is distributed.

```python
@app.task
async def parent(items):
    # asyncio.gather over task calls = N parallel containers
    return await asyncio.gather(*[child(x) for x in items])
```

We get distributed execution for free at the language level. No DAG configs, no DSL, no JSON step definitions. Plain Python, distributed by default. This is what Render's docs brag about and we lean into it.

### 3. Scale-to-zero economics

Workflows bill per-second of execution. Between user chats: zero compute cost. During fan-out: linear in container-count for the duration. The cost model maps cleanly to "agent that thinks in bursts."

### 4. Built-in retry + durability

Each task call has built-in retry policies (exponential backoff). Tasks survive machine failures. We don't write retry plumbing — Render does it. Demo asset: show one leaf fail, retry, succeed in the dashboard.

### 5. Right tool for right SLA

Two-tier architecture is the architectural maturity story:

| Tier | SLA | Render primitive |
|---|---|---|
| Interactive chat (LLM emits code, runs it live) | <2s ideal, <5s acceptable | **Web Service** — in-process subprocess |
| Async / saved bots / fan-out / cron | seconds-to-minutes acceptable | **Render Workflows** |

Pitch line: *"We use Workflows where it shines and Web Services where it shines. We didn't force everything through one primitive."*

---

## Why Render over E2B (honest comparison)

E2B is the obvious alternative — sandboxed Python execution as a service. We considered it. Here's the honest head-to-head:

| Dimension | E2B | Render Workflows | Verdict |
|---|---|---|---|
| Cold start (single run) | ~1–2s | 5.2s median (measured) | E2B faster |
| Edit code → re-run | `sandbox.files.write` instant | git push → rebuild minutes | E2B faster on iteration |
| Built-in retries | Implement yourself | Native task-level policy | **Render** |
| Task chaining ergonomics | Manage sandbox handles | `await some_task()` | **Render** |
| Durable state across infra failures | Sandbox may die | Workflow runs are durable | **Render** |
| Native to Render hardware | Cross-cloud | Same-platform networking | **Render** if agent on Render |
| Observable in Render dashboard | E2B's own dashboard | Render's dashboard | **Render** for this audience |
| Hackathon sponsor primitive | No | Yes | **Render** |

**How we resolve the speed gap:** the in-process tier handles interactive chat (where E2B would win), so Workflows only carry async/fan-out/saved workloads (where cold start doesn't matter). The hybrid sidesteps the comparison E2B would win.

### The architecture-level advantage (this is the strongest line)

Feature-level comparisons miss the bigger point. **E2B is sandbox-only — it has no always-on service primitive.** To support promoted/saved workflows that need stable URLs (webhook responders, long-lived listeners, hot-path APIs), an E2B-based stack must bolt on a separate platform: Kubernetes, ECS, Vercel, or another PaaS.

CodeWords (the product we're cloning) does exactly this: E2B for ephemeral runs, **AWS EKS + ArgoCD + ECR + Terraform** for promoted services. Five platforms, multiple auth boundaries, multiple deploy pipelines, multiple billing dashboards.

Render gives us **both primitives natively in one platform**:

```
CodeWords stack (E2B + always-on services):
  E2B          → ephemeral runs (Type A)
  + AWS EKS    → always-on services (Type B)
  + ArgoCD     → deploy pipeline for Type B
  + AWS ECR    → image registry
  + Terraform  → infra-as-code
  = 5 platforms, multiple auth boundaries

Our Render stack:
  Render Workflows  → Type A
  Render Web Service → Type B
  Render Blueprint  → unified deploy pipeline
  Render dashboard  → unified observability
  = 1 platform
```

Same two-tier architecture (validated by CodeWords at scale). Half the operational surface area. **That's the architecture-level pitch — not feature-by-feature, but stack-shape.**

---

## What's actually novel here

The "first-ever agent on Render Workflows" framing is overclaim — Render Workflows just hit public beta, so almost anything on it is unprecedented. Other platforms (LangGraph Send API, Modal `.spawn_map`, Temporal) have done agent-orchestrated parallelism for a while.

What's **genuinely fresh**:

1. **LLM-in-leaf tasks** — Claude SDK calls running *inside* parallel Workflow containers. Render's published examples cover ETL, file processing, voice agents — all single-track. AI-in-leaves at scale is uncommon.
2. **Task-level fan-out as the agent's "thinking primitive"** — the LLM emits ONE call (`swarm(...)`), the platform fans out internally, returns one merged result. The LLM treats `swarm` like a built-in language feature.
3. **Visible parallelism on Render's dashboard during a live pitch** — sales-asset-grade demo.

Frame as: *"the right substrate for parallel-thinking agents,"* not *"nobody's done this."* Render team will respect the first; they can call out the second.

---

## Demo arc (90 seconds, judge-facing)

1. **(15s)** User: *"Find me the 10 most interesting open-source AI dev tools launched in 2026, summarize what makes each unique."*
2. **(5s)** Agent decides: this is parallel research → calls `swarm(query, fan_out=10)`.
3. **(40s)** Render dashboard pops on screen — **10 containers light up simultaneously**, each running an independent Claude reasoning call (web search + analyze).
4. **(15s)** Sub-tasks complete in parallel; agent reduces to a ranked synthesis.
5. **(15s)** Closing line: *"This took 40 seconds with parallel containers. Sequential would have been 7 minutes. The agent decided when to fan out — Render Workflows is its parallel-thinking primitive."*

Backup demos if research-synthesis lands flat:
- **Code review across N files** — fan out per-file → reduce to one PR comment
- **Multi-source price comparison** — one query, four engines (Perplexity / GPT / Claude / Google), one merged answer
- **Distributed scrape + summarize** — N URLs → N containers → unified report

Research-synthesis is the safest pick because the use case is universally legible.

---

## What Render judges value (revealed preferences)

Per the existing research and Render's published material:

- **Parallel fan-out** with >50 visible containers ✅ (we hit 10–50, tunable for impact)
- **Task chaining** without external DSL ✅ (typed Python, no JSON step files)
- **Retries with exponential backoff** ✅ (each LLM call wrapped in retry policy — show one fail+retry on screen)
- **Scale-to-zero cost story** ✅ (when no chats active, $0)
- **Dashboard observability** ✅ (literally on screen during demo)
- **Novel angle Render-team hasn't seen** ✅ (Workflows running the AI workload itself, not just deterministic code execution)

Existing Render Workflows examples cover ETL, OpenAI agents, file processing, voice agents — all single-track. Our submission fills the **parallel agent-as-Workflows-orchestrator** gap.

---

## Cold-start measurement (the only weak number to address)

Three runs of a `noop_task`: 3.4s / 5.2s / 7.5s. Median 5.2s, high variance.

**How to handle in pitch (if asked):**
- Cold start matters for *interactive* tasks. We don't put interactive on Workflows. The two-tier split is exactly designed around this.
- For fan-out: 5s once, then 10 parallel children all return at roughly the same time. Total wall-clock time is 5s of cold-start + ~max(child_times). For 10 children at 3s each, that's 8s total vs ~30s sequential. The fan-out wins regardless.
- We're capturing more samples to confirm median (target: 10 runs total). Variance is the bigger concern than median — we may add a pre-warm ping before demo runs.

**Don't lead with this number.** It's a speed-bump, not a story.

---

## Open hooks for sponsor conversation

- Render team: *"Would love feedback on the LLM-in-leaf pattern — we couldn't find published examples. Is there an upper bound on parallel containers per task we should know about for org-scope fan-out?"*
- Render hackathon credits: confirm with hackathon organizers; no public April-2026 program found via doc search. Render Startup Program ($5k/$10k/$25k) is the documented credit path.
- Workflows public-beta gotchas: pin SDK version (currently `render_sdk` 0.6.x). API surface may shift.

---

## Pitch one-liners (for slide titles or speaker notes)

- *"Two tiers, two SLAs, two Render primitives — used the way Render meant them."*
- *"The agent's parallel-thinking primitive."*
- *"Distributed execution that reads like local code."*
- *"Watch our agent decide to fan out — and watch your dashboard prove it worked."*
- *"E2B is sandbox-only. CodeWords had to bolt EKS + ArgoCD + ECR onto it just to get always-on services. Render gives us both primitives natively. Same architecture, half the platform stack."*

---

## Narrative spine

This Render story is one expression of a broader theme: **microbots compose and swarm at every scale.** Render Workflows is L1 (micro-workflows within a bot) and L2 (microservices across bots). The full fractal narrative is in `agent/scratchpad/pitch/microbots-fractal.md` — read that for the unifying mental model the whole pitch sits on.

## Adjacent notes (cross-references)

- Architectural decisions: `agent/scratchpad/p1-harness-mvp/plan/01-findings.md` D1–D7
- Cold-start data: `agent/scratchpad/p1-harness-mvp/notes/00-render-workflows-cold-start.md`
- Setup audit (Render CLI, login flow, workspace set): `agent/scratchpad/p1-harness-mvp/notes/01-setup-prereqs.md`
- Multi-modal template discovery (related future feature): `agent/scratchpad/ideas/01-multimodal-template-discovery.md`
- Earlier sponsor-glue research (covers Mubit + Anthropic OAuth + Render basics, pre-architecture-pivot): `agent/scratchpad/p0-braindump-notes/stack/sponsor-glue.md`
