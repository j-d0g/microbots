"""Render Workflows tasks for the harness.

M1 scope:
- noop_task           — cold-start probe
- run_user_code       — execute arbitrary Python in the Workflows container,
                        capture stdout/stderr, return result
- fanout_sum          — fan-out parallelism test
- chain_3             — sequential chain test
- trivial_compute     — subtask used by fanout_sum
- step1/2/3           — subtasks used by chain_3
"""

import asyncio
import io
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout
from typing import Any

from render_sdk import Workflows

app = Workflows()


# ---------- Probes ----------


@app.task
def noop_task() -> dict:
    """Cold-start probe. Returns immediately."""
    return {"status": "ok"}


# ---------- run_user_code ----------


def _serialize(value: Any) -> Any:
    """Best-effort JSON-serialize a value, falling back to repr."""
    if value is None:
        return None
    try:
        import json

        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return repr(value)


@app.task
def run_user_code(code: str, args: dict | None = None) -> dict:
    """Execute Python code in this container.

    - Captures stdout and stderr.
    - Pre-imports the bundled deps so the LLM can `import httpx`, etc.
    - If the code defines `main(args)`, calls it and returns its result.
    - Otherwise, the result is the namespace's last expression value (best
      effort) or None.
    - On exception, returns the traceback in `error`.
    """
    args = args or {}

    # Pre-imports available to user code.
    namespace: dict[str, Any] = {"__name__": "__user__", "args": args}

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    result: Any = None
    error: str | None = None

    try:
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            exec(compile(code, "<user_code>", "exec"), namespace)
            main = namespace.get("main")
            if callable(main):
                value = main(args)
                if asyncio.iscoroutine(value):
                    value = asyncio.run(value)
                result = value
    except SystemExit as exc:
        # Treat SystemExit(0) as success, anything else as error.
        if exc.code not in (0, None):
            error = f"SystemExit: {exc.code}"
    except BaseException:  # noqa: BLE001
        error = traceback.format_exc()

    return {
        "result": _serialize(result),
        "stdout": stdout_buf.getvalue(),
        "stderr": stderr_buf.getvalue(),
        "error": error,
    }


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
