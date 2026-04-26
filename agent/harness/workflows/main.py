"""Render Workflows tasks for the harness.

Phase-0 scope:
- noop_task           — cold-start probe
- run_user_code       — Phase-2 stub (sandboxed Python execution)
- fanout_sum          — fan-out parallelism test
- chain_3             — sequential chain test
- trivial_compute     — subtask used by fanout_sum
- step1/2/3           — subtasks used by chain_3
"""

import asyncio

from render_sdk import Workflows

app = Workflows()


# ---------- Probes ----------


@app.task
def noop_task() -> dict:
    """Phase 0 cold-start probe. Returns immediately."""
    return {"status": "ok"}


@app.task
def run_user_code(code: str, args: dict | None = None) -> dict:
    """Phase 2 stub. Sandboxed execution not yet implemented."""
    return {"error": "not implemented yet"}


# ---------- Fan-out parallelism test ----------


@app.task
def trivial_compute(i: int) -> int:
    """Subtask used by fanout_sum. Pure compute, no delay."""
    return i * i + 1


@app.task
async def fanout_sum(n: int) -> dict:
    """Fan out `n` parallel subtasks via asyncio.gather, sum results.

    Used to measure whether the scheduler actually parallelises subtasks
    (flat latency vs n) or serialises (linear latency vs n).
    """
    results = await asyncio.gather(*(trivial_compute(i) for i in range(n)))
    return {"n": n, "sum": sum(results), "items": results}


# ---------- Chain test ----------


@app.task
def step1(x: int) -> int:
    return x + 10


@app.task
def step2(x: int) -> int:
    return x * 2


@app.task
def step3(x: int) -> int:
    return x - 3


@app.task
async def chain_3(x: int) -> dict:
    """Sequential chain: step1 -> step2 -> step3.

    Measures whether chained calls reuse warm containers or pay cold-start
    each step.
    """
    a = await step1(x)
    b = await step2(a)
    c = await step3(b)
    return {"input": x, "steps": [a, b, c], "final": c}


if __name__ == "__main__":
    app.start()
