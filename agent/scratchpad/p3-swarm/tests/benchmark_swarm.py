"""Benchmark Render Workflows parallelism patterns for the swarm phase.

Measures three flows back-to-back and prints a markdown summary table to
stdout, suitable for pasting into ``notes/02-bench-swarm.md``.

Flows
-----
1. Baseline (cold-start fan-out): 5 ``microbots/noop_task`` runs fired in
   parallel via ThreadPoolExecutor.
2. Pattern A (one task, internal asyncio): 3 SEQUENTIAL
   ``microbots/run_user_code`` runs, each using ``asyncio.gather`` to fetch
   10 URLs inside one Workflows VM. Sequential run order surfaces cold vs
   warm latency.
3. Pattern B (fan-out at the infra layer): 10 PARALLEL
   ``microbots/run_user_code`` runs, each fetching one URL. Models what
   happens when the LLM emits 10 parallel tool calls.

Latency is computed as ``completedAt - startedAt`` from the
``render workflows runs list`` JSON.

Usage
-----
    python3 agent/scratchpad/p3-swarm/tests/benchmark_swarm.py

Requires the ``render`` CLI authenticated against the workspace that owns
the ``microbots`` workflow service. No pip dependencies.
"""

from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

WORKFLOW = "microbots"
POLL_INTERVAL_S = 2.0
RUN_TIMEOUT_S = 60.0

URLS = [
    "https://example.com",
    "https://example.org",
    "https://wikipedia.org",
    "https://python.org",
    "https://render.com",
    "https://anthropic.com",
    "https://github.com",
    "https://news.ycombinator.com",
    "https://www.reddit.com",
    "https://stackoverflow.com",
]

# Code body for Pattern A: one run_user_code that fans out 10 fetches
# internally via asyncio.gather.
PATTERN_A_CODE = '''import asyncio, httpx

async def main(args):
    async with httpx.AsyncClient(timeout=20) as c:
        rs = await asyncio.gather(*(c.get(u) for u in args["urls"]), return_exceptions=True)
    return {"n": len(rs), "statuses": [getattr(r, "status_code", str(r)) for r in rs]}
'''

# Code body for Pattern B: each run_user_code fetches a single URL.
PATTERN_B_CODE = '''import httpx

def main(args):
    r = httpx.get(args["url"], timeout=20)
    return {"status": r.status_code, "bytes": len(r.content)}
'''


# ---------- logging ----------


def log(msg: str) -> None:
    """Progress output to stderr so the markdown stdout stays clean."""
    print(msg, file=sys.stderr, flush=True)


# ---------- render CLI wrappers ----------


def trigger(task: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Start one run of microbots/<task>. Returns parsed CLI JSON.

    Expects a dict with ``id`` (run id) and ``taskId`` (task id).
    """
    inp = json.dumps(payload)
    proc = subprocess.run(
        [
            "render", "workflows", "tasks", "start",
            f"{WORKFLOW}/{task}",
            "--input", inp,
            "--confirm",
            "-o", "json",
        ],
        capture_output=True, text=True, check=True,
    )
    return json.loads(proc.stdout)


def fetch_runs(task_id: str) -> list[dict[str, Any]]:
    """Return the full runs list for a task."""
    proc = subprocess.run(
        ["render", "workflows", "runs", "list", task_id, "-o", "json"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(proc.stdout)


def check_render_cli() -> None:
    """Fail fast with a clear message if the CLI is missing / not on PATH."""
    try:
        subprocess.run(
            ["render", "--version"],
            capture_output=True, check=True, timeout=10,
        )
    except FileNotFoundError:
        log("ERROR: 'render' CLI not found on PATH. Install + authenticate first.")
        sys.exit(2)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        log(f"ERROR: 'render --version' failed: {exc}")
        sys.exit(2)


# ---------- timing helpers ----------


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


TERMINAL_STATUSES = {"completed", "failed", "canceled", "cancelled", "errored"}


def is_terminal(status: str) -> bool:
    return status in TERMINAL_STATUSES


def latency_seconds(run: dict[str, Any]) -> float | None:
    """Return completedAt - startedAt in seconds, or None if either is missing."""
    started = run.get("startedAt")
    completed = run.get("completedAt")
    if not started or not completed:
        return None
    try:
        return (parse_iso(completed) - parse_iso(started)).total_seconds()
    except (TypeError, ValueError):
        return None


def wait_for_runs(
    task_id: str,
    run_ids: list[str],
    deadline_ts: float,
) -> dict[str, dict[str, Any] | None]:
    """Poll until every run_id reaches a terminal status or we hit the deadline.

    Returns ``{run_id: run_dict | None}`` where ``None`` means "still not
    terminal at deadline" (treated as timeout by callers).
    """
    pending = set(run_ids)
    completed: dict[str, dict[str, Any]] = {}
    while pending and time.time() < deadline_ts:
        try:
            runs = fetch_runs(task_id)
        except subprocess.CalledProcessError as exc:
            log(f"  warn: runs list failed (rc={exc.returncode}); retrying")
            time.sleep(POLL_INTERVAL_S)
            continue
        for r in runs:
            rid = r.get("id")
            if rid in pending and is_terminal(str(r.get("status", ""))):
                completed[rid] = r
                pending.discard(rid)
        if pending:
            time.sleep(POLL_INTERVAL_S)
    result: dict[str, dict[str, Any] | None] = dict(completed)
    for rid in pending:
        result[rid] = None
    return result


# ---------- stats ----------


def percentile(values: list[float], p: float) -> float:
    """Linear-interpolation percentile. p in [0, 100]."""
    if not values:
        return 0.0
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


def summarize(values: list[float]) -> dict[str, float]:
    if not values:
        return {"median": 0.0, "p90": 0.0, "max": 0.0, "min": 0.0}
    return {
        "median": statistics.median(values),
        "p90": percentile(values, 90.0),
        "max": max(values),
        "min": min(values),
    }


# ---------- triggering helpers ----------


def safe_trigger(task: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """Trigger and return None on failure (logged) so a single bad shot
    doesn't kill the whole flow."""
    try:
        return trigger(task, payload)
    except subprocess.CalledProcessError as exc:
        log(f"  warn: trigger {task} failed: rc={exc.returncode} stderr={exc.stderr!r}")
        return None


# ---------- flows ----------


def flow_baseline() -> tuple[list[float], int]:
    """Flow 1: 5 noop_task runs fired in parallel via ThreadPoolExecutor."""
    n = 5
    log(f"[flow 1] firing {n} parallel noop_task triggers...")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=n) as ex:
        triggers = list(ex.map(lambda _: safe_trigger("noop_task", {}), range(n)))
    triggers = [t for t in triggers if t is not None]
    log(f"[flow 1] {len(triggers)}/{n} triggered in {time.time() - t0:.2f}s")

    if not triggers:
        return [], n

    task_id = triggers[0]["taskId"]
    run_ids = [t["id"] for t in triggers]
    deadline = time.time() + RUN_TIMEOUT_S
    log(f"[flow 1] polling until terminal or +{RUN_TIMEOUT_S:.0f}s...")
    runs = wait_for_runs(task_id, run_ids, deadline)

    latencies: list[float] = []
    timeouts = n - len(triggers)  # treat trigger failures as timeouts
    for rid in run_ids:
        run = runs.get(rid)
        if run is None:
            timeouts += 1
            log(f"  {rid}: TIMEOUT")
            continue
        lat = latency_seconds(run)
        if lat is None:
            timeouts += 1
            log(f"  {rid}: status={run.get('status')} (no timing)")
            continue
        latencies.append(lat)
        log(f"  {rid}: {lat:.2f}s status={run.get('status')}")
    return latencies, timeouts


def flow_pattern_a() -> tuple[list[float], int]:
    """Flow 2: 3 sequential run_user_code runs, each with internal asyncio fan-out over 10 URLs."""
    n = 3
    payload = {"code": PATTERN_A_CODE, "args": {"urls": URLS}}
    latencies: list[float] = []
    timeouts = 0
    log(f"[flow 2] firing {n} SEQUENTIAL Pattern A runs (10 URLs per run)...")
    for i in range(n):
        log(f"  [{i + 1}/{n}] triggering run_user_code...")
        t = safe_trigger("run_user_code", payload)
        if t is None:
            timeouts += 1
            continue
        deadline = time.time() + RUN_TIMEOUT_S
        runs = wait_for_runs(t["taskId"], [t["id"]], deadline)
        run = runs.get(t["id"])
        if run is None:
            timeouts += 1
            log(f"  {t['id']}: TIMEOUT")
            continue
        lat = latency_seconds(run)
        if lat is None:
            timeouts += 1
            log(f"  {t['id']}: status={run.get('status')} (no timing)")
            continue
        latencies.append(lat)
        log(f"  {t['id']}: {lat:.2f}s status={run.get('status')}")
    return latencies, timeouts


def flow_pattern_b() -> tuple[list[float], int]:
    """Flow 3: 10 parallel run_user_code runs, each fetching one URL."""
    n = 10
    payloads = [
        {"code": PATTERN_B_CODE, "args": {"url": URLS[i]}}
        for i in range(n)
    ]
    log(f"[flow 3] firing {n} PARALLEL Pattern B runs (1 URL per run)...")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=n) as ex:
        triggers = list(ex.map(lambda p: safe_trigger("run_user_code", p), payloads))
    triggers = [t for t in triggers if t is not None]
    log(f"[flow 3] {len(triggers)}/{n} triggered in {time.time() - t0:.2f}s")

    if not triggers:
        return [], n

    task_id = triggers[0]["taskId"]
    run_ids = [t["id"] for t in triggers]
    deadline = time.time() + RUN_TIMEOUT_S
    log(f"[flow 3] polling until terminal or +{RUN_TIMEOUT_S:.0f}s...")
    runs = wait_for_runs(task_id, run_ids, deadline)

    latencies: list[float] = []
    timeouts = n - len(triggers)
    for rid in run_ids:
        run = runs.get(rid)
        if run is None:
            timeouts += 1
            log(f"  {rid}: TIMEOUT")
            continue
        lat = latency_seconds(run)
        if lat is None:
            timeouts += 1
            log(f"  {rid}: status={run.get('status')} (no timing)")
            continue
        latencies.append(lat)
        log(f"  {rid}: {lat:.2f}s status={run.get('status')}")
    return latencies, timeouts


# ---------- output ----------


def fmt(v: float) -> str:
    return f"{v:.2f}"


def render_table(rows: list[dict[str, Any]]) -> str:
    lines = [
        "| Flow | N | Median | P90 | Max | Min | Notes |",
        "|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        s = row["stats"]
        if row["completed"] == 0:
            cells = ["-", "-", "-", "-"]
        else:
            cells = [fmt(s["median"]), fmt(s["p90"]), fmt(s["max"]), fmt(s["min"])]
        notes = row["notes"]
        if row["timeouts"]:
            notes = f"{notes}; {row['timeouts']}/{row['n']} timeout"
        lines.append(
            f"| {row['flow']} | {row['n']} | {cells[0]} | {cells[1]} | "
            f"{cells[2]} | {cells[3]} | {notes} |"
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="benchmark_swarm.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.parse_args()

    check_render_cli()

    rows: list[dict[str, Any]] = []

    lats1, to1 = flow_baseline()
    rows.append({
        "flow": "noop_task cold",
        "n": 5,
        "completed": len(lats1),
        "timeouts": to1,
        "stats": summarize(lats1),
        "notes": "parallel",
        "_lats": lats1,
    })

    lats2, to2 = flow_pattern_a()
    rows.append({
        "flow": "Pattern A (run_user_code, asyncio×10)",
        "n": 3,
        "completed": len(lats2),
        "timeouts": to2,
        "stats": summarize(lats2),
        "notes": "sequential, 10 URLs each",
        "_lats": lats2,
    })

    lats3, to3 = flow_pattern_b()
    rows.append({
        "flow": "Pattern B (run_user_code ×10 parallel)",
        "n": 10,
        "completed": len(lats3),
        "timeouts": to3,
        "stats": summarize(lats3),
        "notes": "parallel, 1 URL each",
        "_lats": lats3,
    })

    # Markdown table to stdout, ready to paste into notes/02-bench-swarm.md.
    print()
    print(render_table(rows))
    print()

    # Verdict. Apples-to-apples 10-URL completion time:
    #   Pattern A: per-run latency (each run already does 10 URLs internally).
    #   Pattern B: max of 10 parallel runs (the demo isn't done until the slowest finishes).
    a_demo = statistics.median(lats2) if lats2 else None
    b_demo = max(lats3) if lats3 else None

    if a_demo is not None and b_demo is not None:
        if a_demo <= b_demo:
            print(f"Winner for 10-URL demo: Pattern A at {a_demo:.2f}s median.")
        else:
            print(f"Winner for 10-URL demo: Pattern B at {b_demo:.2f}s median.")
    elif a_demo is not None:
        print(f"Winner for 10-URL demo: Pattern A at {a_demo:.2f}s median (Pattern B incomplete).")
    elif b_demo is not None:
        print(f"Winner for 10-URL demo: Pattern B at {b_demo:.2f}s median (Pattern A incomplete).")
    else:
        print("Winner for 10-URL demo: inconclusive (no completed runs).")

    return 0


if __name__ == "__main__":
    sys.exit(main())
