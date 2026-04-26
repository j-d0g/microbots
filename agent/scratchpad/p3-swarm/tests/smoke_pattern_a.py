"""Smoke test for the `parallel-fetch-urls` template (Pattern A).

Triggers `microbots/run_user_code` with the template body and a 10-URL
list, polls until terminal state, fetches the full run via
`render workflows runs show`, and emits a PASS/FAIL verdict against the
8 s wall-clock goal from p3-swarm/plan/02-spec.md (Phase 0).

Reproduction:

    python3 agent/scratchpad/p3-swarm/tests/smoke_pattern_a.py

Run from the repo root or any worktree of jordan/microbot_harness_v0.
Requires `render` CLI logged in to Jordan's workspace.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


WORKFLOW = "microbots"
TASK = "run_user_code"
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
POLL_S = 2.0
HARD_LIMIT_S = 90.0
GOAL_S = 8.0


def _repo_root() -> Path:
    """Resolve the repo root by walking up from this file."""
    here = Path(__file__).resolve()
    # tests/ -> p3-swarm/ -> scratchpad/ -> agent/ -> repo root
    return here.parents[4]


def template_code() -> str:
    """Read the canonical code from the mcp index.json so the smoke test
    exercises exactly what the LLM would emit."""
    path = _repo_root() / "agent/harness/mcp/templates/index.json"
    entries = json.loads(path.read_text())
    pf = next(t for t in entries if t["id"] == "parallel-fetch-urls")
    return pf["code"]


def trigger(code: str, args: dict) -> dict:
    payload = json.dumps([code, args])
    cmd = [
        "render", "workflows", "tasks", "start",
        f"{WORKFLOW}/{TASK}",
        "--input", payload,
        "--confirm", "-o", "json",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def show_run(run_id: str) -> dict:
    proc = subprocess.run(
        ["render", "workflows", "runs", "show", run_id, "-o", "json"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(proc.stdout)


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main() -> int:
    code = template_code()
    args = {"urls": URLS}
    print(f"[trigger] firing {TASK} with {len(URLS)} URLs")
    started_local = time.time()
    triggered = trigger(code, args)
    print(f"[trigger] returned in {time.time() - started_local:.2f}s")
    run_id = triggered["id"]
    task_id = triggered["taskId"]
    print(f"  run_id  = {run_id}")
    print(f"  task_id = {task_id}")

    deadline = time.time() + HARD_LIMIT_S
    run: dict | None = None
    last_status = ""
    while time.time() < deadline:
        run = show_run(run_id)
        status = run.get("status", "?")
        if status != last_status:
            print(f"  [poll] status={status}")
            last_status = status
        if status in ("completed", "succeeded", "failed", "errored"):
            break
        time.sleep(POLL_S)

    if run is None or run.get("status") not in (
        "completed", "succeeded", "failed", "errored"
    ):
        print(f"[FAIL] hard-limit {HARD_LIMIT_S}s exceeded; last status={last_status}")
        if run:
            print(json.dumps(run, indent=2)[:2000])
        return 1

    print(f"\n[run-detail] status={run['status']}")
    started_at = run.get("startedAt")
    completed_at = run.get("completedAt")
    if started_at and completed_at:
        wall_clock_s = (
            parse_iso(completed_at) - parse_iso(started_at)
        ).total_seconds()
    else:
        wall_clock_s = float("nan")
    print(f"  startedAt   = {started_at}")
    print(f"  completedAt = {completed_at}")
    print(f"  wall_clock  = {wall_clock_s:.2f}s")

    attempts = run.get("attempts") or []
    if attempts and started_at:
        a = attempts[0]
        a_started = a.get("startedAt")
        a_completed = a.get("completedAt")
        if a_started and a_completed:
            queue_s = (parse_iso(a_started) - parse_iso(started_at)).total_seconds()
            exec_s = (parse_iso(a_completed) - parse_iso(a_started)).total_seconds()
            print(f"  queue_s     = {queue_s:.2f}s")
            print(f"  exec_s      = {exec_s:.2f}s")

    # `runs show` puts the user-visible task return under top-level `results`
    # (a list with one entry per attempt). The dict shape is whatever
    # run_user_code returns: {result, stdout, stderr, error}.
    results_list = run.get("results") or []
    payload = results_list[0] if results_list else {}
    inner = payload.get("result")
    stdout = payload.get("stdout") or ""
    stderr = payload.get("stderr") or ""
    error = payload.get("error") or ""

    if stdout:
        print("\n[stdout]\n" + stdout.rstrip())
    if stderr:
        print("\n[stderr]\n" + stderr.rstrip())
    if error:
        print("\n[error]\n" + error.rstrip())

    verdict = "FAIL"
    reason: list[str] = []
    n_results = 0
    if (
        run["status"] in ("completed", "succeeded")
        and not error
        and isinstance(inner, dict)
        and isinstance(inner.get("results"), list)
    ):
        results = inner["results"]
        n_results = len(results)
        statuses = [r.get("status_code") for r in results]
        all_have_status = all(s is not None for s in statuses)
        if n_results != 10:
            reason.append(f"got {n_results} results, expected 10")
        if not all_have_status:
            reason.append("some entries missing status_code")
        if wall_clock_s > GOAL_S:
            reason.append(f"wall_clock {wall_clock_s:.2f}s > {GOAL_S}s goal")
        if not reason:
            verdict = "PASS"
    else:
        if error:
            reason.append("user-code raised; see [error] above")
        else:
            reason.append(f"run did not produce a usable results dict; status={run['status']}")

    print("\n[verdict]")
    print(f"  verdict     = {verdict}")
    print(f"  wall_clock  = {wall_clock_s:.2f}s (goal <{GOAL_S}s)")
    print(f"  n_results   = {n_results}")
    if reason:
        print(f"  reason      = {'; '.join(reason)}")

    return 0 if verdict == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
