# Render — sponsor demo angle

**Status:** notes only. Does NOT modify `02-spec.md` core P1. Read this when planning the demo flow or pitching the Render prize.

## The angle

Use Render Workflows as the agent's **parallel-thinking primitive** via recursive task chaining. Not as the hot path for inline `run_code` (where it's structurally too slow — see `notes/00-render-workflows-cold-start.md`).

The chat agent has two execution backends and the LLM picks between them:

| Mode | Substrate | Latency | When |
|---|---|---|---|
| `run_local(code)` | `exec()` in MCP service | ~10ms | inline scripting, math, parsing |
| `swarm_research(query, fan_out=N)` | Render Workflows recursive fan-out | ~50-70s for 750 leaves | parallel research, batch enrichment |

## Why this wins the Render prize (per research)

- **No precedent**: research agent confirmed zero existing demos of LLM agent + Render Workflows + recursive task chaining. Total greenfield.
- **Hits Render's biggest brags**: parallel fan-out at scale, task chaining (their unique primitive vs Lambda/Step Functions), retries, scale-to-zero, dashboard observability.
- **Live dashboard wow**: 750 containers light up in a tree on screen during the pitch — judges literally watch their own product working.

Sources: research agent reports in conversation log 2026-04-26.

## The killer demo

User prompt: *"Go through the ~150 hackathon participants, scrape their LinkedIn + Luma + Google + Twitter, and tell me my real competition."*

```python
@app.task
async def swarm_research(participants: list[dict]) -> list[dict]:
    profiles = await asyncio.gather(*[build_profile(p) for p in participants])
    return synthesize(profiles)

@app.task
async def build_profile(person: dict) -> dict:
    li, luma, google, twitter = await asyncio.gather(
        search_linkedin(person),
        search_luma(person),
        search_google(person),
        search_twitter(person),
    )
    return merge_profile(person, li, luma, google, twitter)

@app.task
async def search_linkedin(person: dict) -> dict: ...
@app.task
async def search_luma(person: dict) -> dict: ...
# etc.
```

**751 task invocations** (1 + 150 + 600), depth-3 DAG.

## 90-second pitch arc

1. **(10s)** Setup: "I have 150 hackathon competitors. Here's parallel research."
2. **(15s)** Agent dispatches `swarm_research(...)` → dashboard pops, 150 profile-builders fire.
3. **(30s)** Each fans out into 4 source-searches → 750 containers running in a tree.
4. **(15s)** Reduce: top 5 competitors with summaries in chat.
5. **(20s)** Close: *"750 parallel containers via recursive task chaining. Sequential = 40 min. We did it in 50s. Render Workflows."*

## Latency math

| Level | Tasks | Concurrency cap effect |
|---|---|---|
| L1 orchestrator | 1 | instant |
| L2 profile-builders | 150 | Pro (100 concurrent) → 2 batches × 5-10s = ~15s |
| L3 source searches | 600 | Pro → 6 batches × 5-10s = ~35-50s |
| Reduce | in-process | <1s |
| **Total** | | **~50-70s** |

Demo-tunable: scale to 30 × 3 = 90 leaves on Standard plan (50 concurrent) → ~15-20s, ~$0.50 per demo run.

## Cost per demo run

- Full (150 × 4): Pro plan ~$1-2/run. $50 credit = ~25 demo runs.
- Scaled (30 × 3): Standard plan ~$0.50/run. $50 credit = ~100 runs.

## Implementation pointers

- **Where to place tasks**: extend `agent/harness/workflows/main.py`. Add `swarm_research`, `build_profile`, `search_*` task functions.
- **Source backends** (ranked by hackathon-realism):
  - LinkedIn → **Proxycurl API** (~$0.01-0.10/profile, reliable, 30 min integration)
  - Luma → public API or HTML scrape
  - Google → SERP API (Serper, SerpAPI) or `googlesearch-python`
  - Twitter → Twitter API v2 free tier (limited) or Nitter scrape
- **Participant list source**: stub with hardcoded 5 names for dev; for live demo, scrape from hackathon Slack channel members via Composio or paste a CSV.
- **Concurrency**: confirm purchasable concurrency tier before pitch day. Default Hobby = 20 will bottleneck the demo.
- **Per-task quotas to verify**: argument size 4MB cap (don't pass full HTML, summarize per-source first), 24h run timeout (irrelevant), 500 task definitions per workflow service (irrelevant).

## What this does NOT change

- Core `02-spec.md` 5-tool MCP surface stays the same.
- `consult_docs`, `search_templates`, `Ask_User_A_Question`, `Set_Behavior_Mode` unchanged.
- `run_code` MCP tool definition unchanged at the contract level — implementation now routes to either `exec()` (fast inline) or `swarm_research` (recursive Workflows fan-out) based on LLM intent or an extra param.

## Open questions before locking in

1. Pro plan + purchased concurrency budget approved? (~$1-2 per full demo run)
2. Backend API keys: Proxycurl, SERP API, Twitter — which to provision?
3. Participant list source: hardcoded test list + live scrape, or CSV-only for demo?
4. Full 150 × 4 or scaled 30 × 3?

Decide these in the Phase-2 planning session, not now. P1 core build comes first.
