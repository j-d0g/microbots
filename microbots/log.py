"""Central observability layer powered by Pydantic Logfire.

Configuration is driven by four environment variables (loaded from `.env`):

    LOGFIRE_TOKEN         # project write token — empty = local-only console
    LOGFIRE_SERVICE_NAME  # service name shown in Logfire (default: microbots)
    LOGFIRE_BASE_URL      # Logfire backend (default: auto-detected from token)
    LOGFIRE_ENVIRONMENT   # dev | staging | prod (default: dev)

Region is auto-detected from the token prefix:
    pylf_v1_eu_*   → https://logfire-eu.pydantic.dev
    pylf_v1_us_*   → https://logfire-us.pydantic.dev
Setting LOGFIRE_BASE_URL explicitly always wins.

Every process invocation generates a short `correlation_id` that is
attached as an OpenTelemetry resource attribute, so every record —
console or Logfire — carries it. Override by exporting
``CORRELATION_ID`` before starting the process (useful for propagating
the same id across child processes / jobs).

Usage:

    from microbots import get_logger, span, get_correlation_id

    log = get_logger(__name__)
    log.info("hello {user}", user="alice")

    with span("db.query", table="entity"):
        ...
"""

from __future__ import annotations

import logging
import os
import sys
import uuid
from contextlib import contextmanager
from threading import Lock
from typing import Any, Iterator

import logfire
from dotenv import find_dotenv, load_dotenv

# Walk up from the cwd to find the project's `.env`. This way the script
# works whether you run it from the project root or any subdirectory.
_ENV_PATH = find_dotenv(usecwd=True)
load_dotenv(_ENV_PATH)

# A short, human-readable id unique to this process invocation. Allow the
# caller to pre-set it (e.g. from a job orchestrator) for cross-process
# correlation; otherwise generate a fresh one.
CORRELATION_ID: str = os.getenv("CORRELATION_ID") or uuid.uuid4().hex[:12]

# Logfire write tokens carry their region as a prefix. Auto-route to the
# matching backend so a user who created their token on logfire.pydantic.dev
# (US) doesn't get a 401 from logfire-eu.pydantic.dev (and vice versa).
_TOKEN_REGION_MAP = {
    "pylf_v1_eu_": "https://logfire-eu.pydantic.dev",
    "pylf_v1_us_": "https://logfire-us.pydantic.dev",
}
_DEFAULT_BASE_URL = "https://logfire-eu.pydantic.dev"

_CONFIGURED = False
_CONFIG_LOCK = Lock()


def _ensure_utf8_streams() -> None:
    """Reconfigure stdout/stderr to UTF-8 so Logfire's rich console output
    doesn't crash Windows terminals (default: cp1252)."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 — best effort, never fail setup
            pass


def _attach_correlation_id_to_resource() -> None:
    """Merge ``correlation_id=<id>`` into OTEL_RESOURCE_ATTRIBUTES so every
    record (span / log / metric) Logfire emits carries it — both locally
    and in the backend."""
    marker = f"correlation_id={CORRELATION_ID}"
    existing = os.environ.get("OTEL_RESOURCE_ATTRIBUTES", "")
    if marker in existing:
        return
    os.environ["OTEL_RESOURCE_ATTRIBUTES"] = (
        f"{existing},{marker}" if existing else marker
    )


def _resolve_base_url(token: str | None) -> str:
    """Pick the Logfire backend URL.

    Order of precedence:
      1. ``LOGFIRE_BASE_URL`` env var (explicit override)
      2. Token region prefix (``pylf_v1_eu_*`` → EU, ``pylf_v1_us_*`` → US)
      3. Fallback: EU (this project's documented default)
    """
    explicit = (os.getenv("LOGFIRE_BASE_URL") or "").strip()
    if explicit:
        return explicit
    if token:
        for prefix, url in _TOKEN_REGION_MAP.items():
            if token.startswith(prefix):
                return url
    return _DEFAULT_BASE_URL


def _warn_on_region_mismatch(token: str | None, base_url: str) -> None:
    """If the user pinned ``LOGFIRE_BASE_URL`` to a region that doesn't
    match their token's prefix, surface that immediately — otherwise the
    only feedback is a 401 from the export pipeline minutes later."""
    if not token or not os.getenv("LOGFIRE_BASE_URL"):
        return
    for prefix, url in _TOKEN_REGION_MAP.items():
        if token.startswith(prefix) and url != base_url:
            sys.stderr.write(
                "\n[microbots.log] WARNING: LOGFIRE_BASE_URL is "
                f"'{base_url}' but the configured LOGFIRE_TOKEN starts "
                f"with '{prefix}', which is the {url} region. Logfire "
                "will return 401. Either remove LOGFIRE_BASE_URL from "
                ".env (auto-detection will pick the correct region) or "
                f"set LOGFIRE_BASE_URL={url}.\n\n"
            )
            return


def _preflight_token_check(token: str, base_url: str) -> None:
    """Send one synchronous HTTP request to Logfire with the token so an
    invalid-token 401 surfaces at startup instead of minutes later in the
    async export pipeline. Best-effort — never fails setup."""
    if os.getenv("LOGFIRE_VERIFY_TOKEN", "").strip().lower() in {
        "0", "false", "no", "off", "n"
    }:
        return

    try:
        import requests  # transitive dep via logfire
    except ImportError:
        return

    url = f"{base_url.rstrip('/')}/v1/traces"
    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {token}"},
            data=b"",
            timeout=3,
        )
    except requests.RequestException as exc:
        sys.stderr.write(
            f"\n[microbots.log] could not reach Logfire at {url} for a "
            f"token pre-flight ({exc}). Skipping check.\n\n"
        )
        return

    if resp.status_code in (401, 403):
        body_preview = (resp.text or "").strip().replace("\n", " ")[:250]
        sys.stderr.write(
            "\n" + "=" * 72 + "\n"
            "[microbots.log]  LOGFIRE REJECTED THE TOKEN  (pre-flight check)\n"
            + "=" * 72 + "\n"
            f"  POST {url}\n"
            f"  status: HTTP {resp.status_code}\n"
            f"  body:   {body_preview}\n"
            f"  token:  prefix='{token[:15]}...'  length={len(token)}\n"
            "\n  Why this usually happens (in order of likelihood):\n\n"
            "    1. You pasted a READ token. Logfire has two kinds of\n"
            "       tokens — write tokens ship records, read tokens query\n"
            "       them (used by the MCP). Logfire UI -> your project ->\n"
            "       Settings -> *Write* tokens -> Create write token.\n\n"
            "    2. Token is for a different project. Verify the project\n"
            "       you created the token in matches the one you're trying\n"
            "       to ship to. A single account can have many projects.\n\n"
            "    3. The token was revoked or expired. Regenerate it from\n"
            "       the same Settings page.\n\n"
            "    4. Copy-paste corruption. A legit Logfire write token is\n"
            f"       typically ~40-55 chars and starts with 'pylf_v1_'. Yours\n"
            f"       is {len(token)} chars and starts with '{token[:10]}...'.\n"
            "       If either looks off, re-copy from the Logfire UI.\n"
            "\n  The script will keep running (you'll still see console output),\n"
            "  but records will NOT reach Logfire until the token is fixed.\n"
            "  Set LOGFIRE_VERIFY_TOKEN=false to silence this pre-flight check.\n"
            + "=" * 72 + "\n\n"
        )


def setup_logging(*, force: bool = False) -> None:
    """Configure Logfire from environment variables.

    Idempotent — repeated calls are no-ops unless ``force=True``.
    """
    global _CONFIGURED
    with _CONFIG_LOCK:
        if _CONFIGURED and not force:
            return

        _ensure_utf8_streams()
        _attach_correlation_id_to_resource()

        # Strip whitespace — copy-paste from a browser often sneaks in
        # trailing newlines/spaces that break the API token check.
        token = (os.getenv("LOGFIRE_TOKEN") or "").strip() or None
        service_name = os.getenv("LOGFIRE_SERVICE_NAME", "microbots")
        environment = (os.getenv("LOGFIRE_ENVIRONMENT") or "dev").strip()
        base_url = _resolve_base_url(token)

        _warn_on_region_mismatch(token, base_url)
        if token:
            _preflight_token_check(token, base_url)

        logfire.configure(
            token=token,
            service_name=service_name,
            environment=environment,
            send_to_logfire="if-token-present",
            # Console mirrors exactly what would ship to Logfire — no
            # separate min-level filter, so local output and remote
            # output stay identical.
            console=logfire.ConsoleOptions(min_log_level="debug"),
            advanced=logfire.AdvancedOptions(base_url=base_url),
        )

        # Route stdlib `logging` records through Logfire so third-party libs
        # (surrealdb, urllib3, …) flow into the same sink.
        root = logging.getLogger()
        for existing in list(root.handlers):
            if isinstance(existing, logfire.LogfireLoggingHandler):
                root.removeHandler(existing)
        root.addHandler(logfire.LogfireLoggingHandler())
        root.setLevel(logging.INFO)

        _CONFIGURED = True

        # Diagnostic banner — one line that exposes everything you need
        # to debug 401s, region mismatches, missing .env, etc.
        token_prefix = (token[:15] + "...") if token else "(none)"
        logfire.info(
            "logging initialized correlation_id={correlation_id} "
            "service={service} env={environment} base_url={base_url} "
            "ship_to_logfire={ship} token_prefix={token_prefix} "
            "token_len={token_len} env_file={env_file} "
            "logfire_ver={logfire_ver}",
            correlation_id=CORRELATION_ID,
            service=service_name,
            environment=environment,
            base_url=base_url,
            ship=bool(token),
            token_prefix=token_prefix,
            token_len=len(token) if token else 0,
            env_file=_ENV_PATH or "(none)",
            logfire_ver=getattr(logfire, "__version__", "?"),
        )


def get_correlation_id() -> str:
    """Return this run's correlation id. Stable for the lifetime of the process."""
    return CORRELATION_ID


def get_logger(name: str | None = None) -> logfire.Logfire:
    """Return a Logfire logger tagged with ``name``.

    The tag becomes a filter in the Logfire UI — pass ``__name__``.
    """
    if not _CONFIGURED:
        setup_logging()
    return logfire.with_tags(name or "microbots")


@contextmanager
def span(name: str, **attributes: Any) -> Iterator[Any]:
    """Open a Logfire span as a context manager."""
    if not _CONFIGURED:
        setup_logging()
    with logfire.span(name, **attributes) as current:
        yield current


def instrument(*args: Any, **kwargs: Any) -> Any:
    """Decorator that wraps a function call in a Logfire span.

    Forwards directly to ``logfire.instrument``.
    """
    if not _CONFIGURED:
        setup_logging()
    return logfire.instrument(*args, **kwargs)
