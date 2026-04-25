"""Manual demo of the microbots logging facade.

Run (either works):
    uv run python test/test_logging.py        # uses the uv-managed venv
    python test/test_logging.py               # uses your current Python

or a single scenario:
    uv run python test/test_logging.py 3      # run only scenario 3
    uv run python test/test_logging.py 1,4,7  # run scenarios 1, 4, and 7

This is NOT a pytest suite — it's a runnable script that emits sample
records (logs, spans, exceptions, async workflows) so you can see exactly
what the central logger produces locally. If ``LOGFIRE_TOKEN`` is set in
``.env``, the same records are also shipped to Logfire.
"""

from __future__ import annotations

import asyncio
import random
import sys
import time
from pathlib import Path

# Make the project root importable even when the script is invoked directly
# (``python test/test_logging.py``) instead of via ``uv run``. This lets the
# script find the ``microbots`` package without needing the project to be
# installed into the active Python interpreter.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

try:
    from microbots import (  # noqa: E402 — import after sys.path tweak
        get_correlation_id,
        get_logger,
        instrument,
        setup_logging,
        span,
    )
except ImportError as exc:
    # Most common cause: you invoked the script with a Python interpreter
    # that doesn't have the project's runtime deps installed (logfire,
    # python-dotenv, surrealdb). The uv-managed venv already has them.
    sys.stderr.write(
        "\nError importing microbots/logfire: " + str(exc) + "\n"
        "\nYour Python (" + sys.executable + ") is missing the project's deps.\n"
        "\nRun one of these instead:\n"
        "    uv run python test/test_logging.py\n"
        "    .venv/Scripts/python test/test_logging.py      (Windows, after 'uv sync')\n"
        "    .venv/bin/python test/test_logging.py          (macOS / Linux, after 'uv sync')\n"
        "    pip install -e .                                (installs project + deps into current Python)\n"
        "\n"
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Scenario 1 — Every severity level
# ---------------------------------------------------------------------------
def scenario_1_levels() -> None:
    """Emit one record at each severity level."""
    log = get_logger("demo.levels")

    log.debug("debug — the verbose one, usually hidden in prod", cache_key="user:42")
    log.info("info — normal operational chatter", route="/health")
    log.notice("notice — worth highlighting but not alarming", retries_left=2)
    log.warn("warn — something unusual happened", attempt=3)
    log.error("error — an operation failed", error_code="E100")
    log.fatal("fatal — giving up on this process", host="db-1")


# ---------------------------------------------------------------------------
# Scenario 2 — Structured attributes + templated messages
# ---------------------------------------------------------------------------
def scenario_2_structured() -> None:
    """Attach queryable attributes. Template placeholders go both into the
    rendered message AND recorded as attrs."""
    log = get_logger("demo.structured")

    # kwargs → queryable attributes
    log.info(
        "user signed in",
        user_id=42,
        action="login",
        plan="pro",
        ip="192.168.1.10",
    )

    # {placeholder} syntax: interpolates AND keeps attrs queryable
    log.info(
        "deploying {branch} to {env} by {user}",
        branch="main",
        env="staging",
        user="desmond",
    )

    # nested data structures are serialized to JSON attributes
    log.info(
        "order placed",
        order={"id": "ord_123", "items": 3, "total_cents": 19_900},
        currency="USD",
    )


# ---------------------------------------------------------------------------
# Scenario 3 — Spans (context managers)
# ---------------------------------------------------------------------------
def scenario_3_spans() -> None:
    """Spans measure how long a unit of work takes. They nest, and you
    can add attributes to the current span as you go."""
    log = get_logger("demo.spans")

    with span("checkout", order_id="ord_123", total_cents=19_900):
        log.info("checkout started")

        with span("validate_cart", item_count=3):
            time.sleep(0.01)
            log.debug("cart ok")

        with span("charge_card", method="stripe") as s:
            time.sleep(0.02)
            s.set_attribute("charge_id", "ch_xyz")
            log.info("card charged")

        with span("send_receipt", channel="email"):
            time.sleep(0.005)
            log.info("receipt sent")

        log.info("checkout complete")


# ---------------------------------------------------------------------------
# Scenario 4 — @instrument decorator (sync + async)
# ---------------------------------------------------------------------------
@instrument("demo.decorated_sync")
def decorated_sync(x: int, y: int) -> int:
    """@instrument turns a function call into a span automatically.
    Arguments are recorded as span attributes by default."""
    time.sleep(0.01)
    return x + y


@instrument("demo.decorated_async")
async def decorated_async(n: int) -> int:
    """Works the same on async functions."""
    await asyncio.sleep(0.01)
    return n * n


def scenario_4_instrument() -> None:
    log = get_logger("demo.instrument")
    log.info("calling sync decorated function")
    result = decorated_sync(2, 3)
    log.info("sync decorated returned {result}", result=result)

    log.info("calling async decorated function")
    result = asyncio.run(decorated_async(7))
    log.info("async decorated returned {result}", result=result)


# ---------------------------------------------------------------------------
# Scenario 5 — Exception capture
# ---------------------------------------------------------------------------
def scenario_5_exceptions() -> None:
    """log.exception() attaches the active traceback. If the exception
    escapes an open span, the span is automatically marked as errored."""
    log = get_logger("demo.exceptions")

    # caught and logged, not re-raised
    try:
        raise ValueError("invalid payload: missing 'user_id'")
    except ValueError:
        log.exception(
            "validation failed — logged and swallowed",
            payload_id="p_1",
        )

    # exception inside a span — the span is marked errored in the UI
    try:
        with span("risky_op", retries=2):
            raise RuntimeError("downstream timeout after 30s")
    except RuntimeError:
        log.exception("risky_op failed, moving on")


# ---------------------------------------------------------------------------
# Scenario 6 — Correlation ID visibility
# ---------------------------------------------------------------------------
def scenario_6_correlation() -> None:
    """Every record above and below this scenario carries the same
    correlation_id as a resource attribute. This scenario just makes
    that visible."""
    log = get_logger("demo.correlation")

    cid = get_correlation_id()
    log.info("this run's correlation_id is {cid}", cid=cid)
    log.info(
        "filter in the Logfire UI with:  correlation_id = \"{cid}\"",
        cid=cid,
    )
    log.info(
        "propagate across processes with:  CORRELATION_ID={cid} python worker.py",
        cid=cid,
    )


# ---------------------------------------------------------------------------
# Scenario 7 — A realistic async workflow (the kind the Render SDK will do)
# ---------------------------------------------------------------------------
async def scenario_7_async_workflow() -> None:
    log = get_logger("demo.pipeline")

    with span("pipeline.deploy", branch="main", env="staging"):
        log.info("pipeline started")

        with span("pipeline.build", image_tag="microbots:latest"):
            await asyncio.sleep(0.03)
            log.info("docker image built", size_mb=187)

        with span("pipeline.push", registry="ghcr.io"):
            await asyncio.sleep(0.02)
            log.info("image pushed to registry")

        with span("pipeline.trigger_render", service_id="srv-abc"):
            await asyncio.sleep(0.01)
            log.info("Render deploy triggered")

        with span("pipeline.wait_live") as s:
            attempts = 0
            for attempt in range(1, 4):
                attempts = attempt
                await asyncio.sleep(0.01)
                log.debug("poll status attempt={n}", n=attempt)
            s.set_attribute("poll_attempts", attempts)
            log.notice(
                "service is live",
                url="https://microbots.onrender.com",
                build_seconds=0.07,
            )


# ---------------------------------------------------------------------------
# Scenario 8 — Multiple loggers (different module scopes)
# ---------------------------------------------------------------------------
def scenario_8_multi_loggers() -> None:
    """Each logger is tagged by name. The tag shows up in the Logfire UI
    and in local console (in square brackets) so you can filter per-module."""
    auth = get_logger("demo.auth")
    db = get_logger("demo.db")
    http = get_logger("demo.http")

    auth.info("token verified", subject="u_42")
    db.info("query ran", table="entity", rows=17, ms=12)
    http.info("GET /api/v1/entities -> 200", ms=83)


# ---------------------------------------------------------------------------
# Scenario 9 — Randomized load (many records fast)
# ---------------------------------------------------------------------------
def scenario_9_load() -> None:
    """Emit 25 mixed records in quick succession — useful for eyeballing
    the Logfire UI's real-time tail and confirming batching/flush works."""
    log = get_logger("demo.load")
    rng = random.Random(42)

    users = ["alice", "bob", "carol", "desmond", "eve"]
    actions = ["login", "logout", "view", "edit", "delete"]

    for i in range(25):
        user = rng.choice(users)
        action = rng.choice(actions)
        duration_ms = rng.randint(5, 250)
        log.info(
            "{user} performed {action}",
            user=user,
            action=action,
            sequence=i,
            duration_ms=duration_ms,
        )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
SCENARIOS = [
    ("1", "every severity level", scenario_1_levels),
    ("2", "structured / templated", scenario_2_structured),
    ("3", "spans (nested, attrs)", scenario_3_spans),
    ("4", "@instrument decorator", scenario_4_instrument),
    ("5", "exceptions + tracebacks", scenario_5_exceptions),
    ("6", "correlation id", scenario_6_correlation),
    ("7", "async workflow", None),  # special: awaited below
    ("8", "multiple loggers", scenario_8_multi_loggers),
    ("9", "load (25 records)", scenario_9_load),
]


def _parse_requested(argv: list[str]) -> set[str]:
    """Parse a CSV of scenario numbers from argv[1:]."""
    if len(argv) < 2:
        return {s[0] for s in SCENARIOS}
    raw = ",".join(argv[1:])
    return {token.strip() for token in raw.split(",") if token.strip()}


def main() -> None:
    setup_logging()

    root = get_logger("demo.runner")
    cid = get_correlation_id()
    requested = _parse_requested(sys.argv)

    root.info("=" * 66)
    root.info("microbots logging demo  |  correlation_id={cid}", cid=cid)
    root.info("=" * 66)

    for num, label, fn in SCENARIOS:
        if num not in requested:
            continue

        root.info("")
        root.info("----- scenario {num}: {label} -----", num=num, label=label)

        if num == "7":
            asyncio.run(scenario_7_async_workflow())
        elif fn is not None:
            fn()

    root.info("")
    root.info("=" * 66)
    root.info(
        "demo complete  |  search logfire for:  correlation_id = \"{cid}\"",
        cid=cid,
    )
    root.info("=" * 66)


if __name__ == "__main__":
    main()
