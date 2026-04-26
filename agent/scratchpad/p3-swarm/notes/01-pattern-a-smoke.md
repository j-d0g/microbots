# 01 — Pattern A smoke (parallel-fetch-urls)

Phase 0 of `p3-swarm/plan/02-spec.md`: confirm a 10-URL `httpx.AsyncClient + asyncio.gather` body returns within ~8 s as one `run_user_code` task on the deployed `microbots` workflow.

## TL;DR

| | |
|---|---|
| Template added (`mcp` + `frontend`) | YES, byte-identical |
| Smoke verdict | **FAIL** |
| Wall-clock (cold / warm) | 10.80 s / 3.19 s |
| Root cause | `run_user_code` is sync but the Workflows worker already has a running asyncio loop, so `asyncio.run(coroutine)` raises `RuntimeError`. No fetches were ever issued. |
| Blocker | One-line fix in `agent/harness/workflows/main.py`; needs commit + push to redeploy |

The 8 s goal isn't actually exercised yet — the task errors out before opening an `httpx.AsyncClient`. Latency above is dominated by import/traceback cost, not network I/O.

## Template added

Inserted as the third entry (between `fetch-and-count-words` and `slack-ping`) in BOTH:

- `agent/harness/mcp/templates/index.json`
- `agent/harness/frontend/templates/index.json`

Both files are byte-identical (`md5 = bfab5bfa3f5c5ef20dffac97faf87a71`).

```json
{
  "id": "parallel-fetch-urls",
  "title": "Fetch N URLs in parallel",
  "description": "Fetches a list of URLs concurrently via httpx.AsyncClient + asyncio.gather. Returns status, byte count, and word count per URL plus total elapsed time. Use this pattern whenever the user asks for parallel I/O — one run_code call with internal gather is faster than N sequential run_code calls.",
  "tags": ["parallel", "async", "fetch", "httpx", "asyncio", "url", "scrape"],
  "code": "<below>"
}
```

Decoded `code` (24 lines):

```python
import asyncio
import time
import httpx

async def _fetch(client, url):
    try:
        r = await client.get(url)
        byte_count = len(r.content)
        word_count = len(r.text.split())
        print(f"[{r.status_code}] {url} bytes={byte_count} words={word_count}")
        return {"url": url, "status_code": r.status_code, "byte_count": byte_count, "word_count": word_count}
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[ERR] {url} {err}")
        return {"url": url, "error": err}

async def main(args):
    urls = args.get("urls", [])
    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        results = await asyncio.gather(*(_fetch(client, u) for u in urls))
    elapsed = time.perf_counter() - t0
    print(f"total {len(results)} urls in {elapsed:.2f}s")
    return {"results": results, "elapsed_s": elapsed}
```

Per-URL failures are caught inside `_fetch`, so one bad URL never poisons `gather`. Each entry either has `{url, status_code, byte_count, word_count}` or `{url, error}`.

## Smoke runs

Workflow: `microbots` (id `wfl-d7mn9n9f9bms7383cad0`), version `70b4b95` (id `wfv-d7mpfr8k1i2s73fnjtt0`).
Task: `run_user_code` (id `tsk-d7mpghhv9ops73bvm4o0`).

10 URLs: `example.com, example.org, wikipedia.org, python.org, render.com, anthropic.com, github.com, news.ycombinator.com, www.reddit.com, stackoverflow.com`.

| run_id | startedAt | wall_clock_s | queue_s | exec_s | status | inner result |
|---|---|---|---|---|---|---|
| `trn-08t4gd7mso3m8bjmc738gvkqg` | 08:25:50.17Z | **10.80** | 0.31 | 10.49 | completed | `error` (asyncio.run) |
| `trn-08t4gd7mspjog4nts73ar5am0` | 08:29:03.38Z | **3.19** | 0.29 | 2.90 | completed | `error` (asyncio.run) |

Run 1 paid a full cold-start (10.49 s exec is mostly Python boot + module imports + traceback formatting before the user code even reaches `httpx.AsyncClient`). Run 2 hit a warm container, so 2.90 s exec is closer to "what import + raise costs in a fresh interpreter namespace". Neither run actually fetched any URL — the error happens before `async with httpx.AsyncClient(...)`.

Both runs end with `status="completed"` at the Render layer because the wrapper caught the exception and returned `{error: "..."}`. The CLI status alone is misleading; the verdict has to come from `result.results[0].error`.

### Inner failure (verbatim from `runs show`)

```
Traceback (most recent call last):
  File "/opt/render/project/src/agent/harness/workflows/main.py", line 78, in run_user_code
    value = asyncio.run(value)
  File "/opt/render/project/python/Python-3.14.3/lib/python3.14/asyncio/runners.py", line 200, in run
    raise RuntimeError(
        "asyncio.run() cannot be called from a running event loop")
RuntimeError: asyncio.run() cannot be called from a running event loop
```

## Verdict vs the 8 s goal

**FAIL** — but not because the goal is too tight. The deployed `run_user_code` cannot run an async user `main()` at all; it crashes before doing any I/O. Pattern A is currently 0/10 entries returned.

Once the fix below ships, the expected math is:

- cold: ~5 s container start + ~1–2 s for 10 parallel fetches ⇒ ~6–7 s
- warm: ~0.5 s queue + ~1–2 s fetches ⇒ ~2–3 s

The 8 s goal is comfortably hit on warm runs and likely on cold ones too. We just can't verify it until the wrapper is fixed.

## Root cause

`agent/harness/workflows/main.py` defines:

```python
@app.task
def run_user_code(code: str, args: dict | None = None) -> dict:
    ...
    if callable(main):
        value = main(args)
        if asyncio.iscoroutine(value):
            value = asyncio.run(value)        # ← fails
        result = value
```

The Render Workflows SDK dispatches each task call from inside an existing asyncio event loop (the worker is async). `asyncio.run()` insists on creating a *new* loop, which collides — Python 3.14 raises `RuntimeError: asyncio.run() cannot be called from a running event loop`.

The bundled deps include `httpx` (verified — the import didn't fail; only the dispatch path did), so the spec's other failure hypotheses ("bundled-deps missing? httpx import error?") are ruled out.

This also explains why the existing `fanout_sum` and `chain_3` tasks work: they are declared `async def`, so the SDK awaits them directly — no `asyncio.run()` on the user side.

## Fix proposal

Make `run_user_code` itself an async task and `await` the coroutine. One file, ~3 line edit, no new dependencies, no schema change.

```diff
 @app.task
-def run_user_code(code: str, args: dict | None = None) -> dict:
+async def run_user_code(code: str, args: dict | None = None) -> dict:
     ...
     if callable(main):
         value = main(args)
         if asyncio.iscoroutine(value):
-            value = asyncio.run(value)
+            value = await value
         result = value
```

Synchronous user code (the existing `hello-world`, `fetch-and-count-words`, `slack-ping` templates) continues to work — `main(args)` returns a non-coroutine, the `iscoroutine` branch is skipped, and the wrapper returns directly.

This change is local-only; deploying it requires committing and pushing on `jordan/microbot_harness_v0` (the Render workflow auto-deploys from this branch). Per the lane-A constraints I have not committed or pushed.

### Why not other workarounds

- `loop.run_until_complete(value)` from inside a sync task: also fails when the dispatcher loop is already running on the same thread.
- Running the coroutine on a fresh thread + new loop: works but doubles cold-start cost and breaks `redirect_stdout`/`redirect_stderr` (those are thread-local).
- Forcing user code to call `asyncio.run` itself: pushes complexity into every template and breaks the "user writes `async def main`" idiom we're documenting.

The async wrapper is the cleanest option.

## Reproduction

After the fix is deployed (or to reproduce the FAIL on the current build):

```bash
cd /Users/jordantran/Agemo/microbots/agent/.worktrees/jordan-microbot_harness_v0
python3 agent/scratchpad/p3-swarm/tests/smoke_pattern_a.py
```

The script:
1. Reads the canonical template body from `agent/harness/mcp/templates/index.json` (so it tests exactly what `find_examples` would surface).
2. Triggers `microbots/run_user_code` with `[code, {"urls": [...10 URLs]}]` via `render workflows tasks start --confirm -o json`.
3. Polls `render workflows runs show <run_id> -o json` every 2 s until terminal (90 s hard limit).
4. Computes wall-clock from `completedAt - startedAt`, asserts 10 results each with a `status_code`, prints PASS/FAIL.

Exit code: `0` PASS, `2` FAIL, `1` timeout.

## Open follow-ups

- Apply the fix above to `agent/harness/workflows/main.py`, push to `jordan/microbot_harness_v0`, wait for Render to roll out the new version, re-run the smoke. Expected wall-clock: ≤7 s cold, ≤3 s warm.
- After PASS, lock in the numbers in `notes/02-bench-swarm.md` once Lane C's benchmark runs.
- Consider hardening: cap `urls` length (e.g. 100) and surface a clear error if `args["urls"]` is missing/wrong type. Out of scope for v0; useful before the demo.
