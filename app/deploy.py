"""Deploy the unified microbots FastAPI app via ``render_sdk``.

Usage::

    .venv/Scripts/python app/deploy.py              # deploy
    .venv/Scripts/python app/deploy.py --status     # read registry entry
    .venv/Scripts/python app/deploy.py --teardown   # delete service + entry
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(REPO_ROOT / ".env")

from render_sdk import RenderSDK, RenderSDKError  # noqa: E402

SERVICE_PATH = Path(__file__).resolve().parent

RUNTIME_ENV_KEYS = (
    "SURREAL_URL",
    "SURREAL_USER",
    "SURREAL_PASS",
    "SURREAL_NS",
    "SURREAL_DB",
    "COMPOSIO_API_KEY",
    "COMPOSIO_USER_ID",
    "OPENROUTER_API_KEY",       # present so agent paths that call LLMs work
    "LOGFIRE_TOKEN",            # optional — lets the deployed service emit Logfire traces
    "LOGFIRE_SERVICE_NAME",
    "LOGFIRE_ENVIRONMENT",
)


def _runtime_env_vars() -> dict[str, str]:
    """Pull relevant keys from the host .env for the deployed container."""
    out: dict[str, str] = {}
    required = ("SURREAL_URL", "SURREAL_USER", "SURREAL_PASS")
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        raise SystemExit(f"Missing required env vars in .env: {missing}")
    for k in RUNTIME_ENV_KEYS:
        v = os.getenv(k)
        if v:
            out[k] = v
    return out


def deploy() -> int:
    print(f"[deploy] Target folder: {SERVICE_PATH}")
    if not (SERVICE_PATH / "Dockerfile").exists():
        print(f"[deploy] FATAL: no Dockerfile at {SERVICE_PATH}", file=sys.stderr)
        return 2

    sdk = RenderSDK(log_level="INFO")
    env_vars = _runtime_env_vars()
    print(f"[deploy] Passing {len(env_vars)} env vars to the container "
          f"({', '.join(sorted(env_vars.keys()))})")

    try:
        result = sdk.deploy(
            local_path=str(SERVICE_PATH),
            env_vars=env_vars,
            log_callback=lambda msg: print(f"  - {msg}"),
        )
    except RenderSDKError as e:
        print(f"\n[deploy] FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    print("\n" + "=" * 60)
    print(f"  LIVE URL     : {result.url}")
    print(f"  service_id   : {result.service_id}")
    print(f"  service_name : {result.service_name}")
    print(f"  image_tag    : {result.image_tag}")
    print(f"  is_new       : {result.is_new}")
    print(f"  duration     : {result.duration_s}s")
    print("=" * 60)

    print("\n[deploy] Probing /api/health...")
    _probe(result.url + "/api/health")
    return 0


def _probe(url: str, retries: int = 8, delay: float = 5.0) -> None:
    import requests

    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, timeout=15)
            short = resp.text.replace("\n", " ")[:200]
            print(f"  attempt {attempt}: HTTP {resp.status_code}  {short}")
            if resp.ok:
                return
        except requests.RequestException as e:
            print(f"  attempt {attempt}: {type(e).__name__}: {e}")
        time.sleep(delay)
    print("  giving up — service may still be warming. Check Render dashboard.")


def status() -> int:
    sdk = RenderSDK(log_level="WARNING")
    info = sdk.status(str(SERVICE_PATH))
    if info is None:
        print(f"[status] No registry entry for {SERVICE_PATH}")
        return 0
    for k, v in info.items():
        print(f"  {k:14s}: {v}")
    return 0


def teardown() -> int:
    sdk = RenderSDK(log_level="INFO")
    try:
        sdk.teardown(str(SERVICE_PATH))
    except RenderSDKError as e:
        print(f"[teardown] FAILED: {e}", file=sys.stderr)
        return 1
    print(f"[teardown] Removed registry entry for {SERVICE_PATH}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy the unified microbots app to Render.")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--teardown", action="store_true")
    args = parser.parse_args()

    if args.status:
        return status()
    if args.teardown:
        return teardown()
    return deploy()


if __name__ == "__main__":
    sys.exit(main())
