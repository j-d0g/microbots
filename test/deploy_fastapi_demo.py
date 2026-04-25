"""End-to-end smoke test for render_sdk.

Reads credentials from the repo-root .env, then deploys
test/fastapi_demo/ to Render and prints the live URL.

Usage::

    # From repo root, with project venv active:
    .venv/Scripts/python test/deploy_fastapi_demo.py

    # Or via uv:
    uv run python test/deploy_fastapi_demo.py

    # Optional flags:
    --teardown          remove the deployed service from Render + registry
    --status            print registry entry for the demo path and exit
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

# Load env vars from repo root .env *before* importing the SDK so that
# os.environ[...] lookups in RenderSDK.__init__ succeed.
load_dotenv(REPO_ROOT / ".env")

from render_sdk import RenderSDK, RenderSDKError  # noqa: E402

DEMO_PATH = REPO_ROOT / "test" / "fastapi_demo"


def deploy() -> int:
    print(f"[deploy] Target folder: {DEMO_PATH}")
    if not DEMO_PATH.exists():
        print(f"[deploy] FATAL: {DEMO_PATH} does not exist.", file=sys.stderr)
        return 2

    sdk = RenderSDK(log_level="INFO")

    try:
        result = sdk.deploy(
            local_path=str(DEMO_PATH),
            log_callback=lambda msg: print(f"  · {msg}"),
        )
    except RenderSDKError as e:
        print(f"\n[deploy] FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    print("\n" + "=" * 60)
    print(f"  LIVE URL     : {result.url}")
    print(f"  service_id   : {result.service_id}")
    print(f"  service_name : {result.service_name}")
    print(f"  image_tag    : {result.image_tag}")
    print(f"  region       : {result.region}")
    print(f"  is_new       : {result.is_new}")
    print(f"  duration     : {result.duration_s}s")
    print("=" * 60)

    print("\n[deploy] Verifying live URL with /health probe...")
    _probe(result.url + "/health")
    return 0


def _probe(url: str, retries: int = 6, delay: float = 5.0) -> None:
    """Hit a URL a few times in case Render is still warming the container."""
    import requests

    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, timeout=10)
            print(f"  attempt {attempt}: HTTP {resp.status_code} — {resp.text[:120]}")
            if resp.ok:
                return
        except requests.RequestException as e:
            print(f"  attempt {attempt}: {type(e).__name__}: {e}")
        time.sleep(delay)
    print("  giving up — service might still be warming. Try again in a minute.")


def status() -> int:
    sdk = RenderSDK(log_level="WARNING")
    info = sdk.status(str(DEMO_PATH))
    if info is None:
        print(f"[status] No registry entry for {DEMO_PATH}")
        return 0
    for k, v in info.items():
        print(f"  {k:14s}: {v}")
    return 0


def teardown() -> int:
    sdk = RenderSDK(log_level="INFO")
    try:
        sdk.teardown(str(DEMO_PATH))
    except RenderSDKError as e:
        print(f"[teardown] FAILED: {e}", file=sys.stderr)
        return 1
    print(f"[teardown] Removed registry entry for {DEMO_PATH}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy test/fastapi_demo to Render.")
    parser.add_argument("--status", action="store_true", help="Show registry entry and exit.")
    parser.add_argument("--teardown", action="store_true", help="Delete service + registry entry.")
    args = parser.parse_args()

    if args.status:
        return status()
    if args.teardown:
        return teardown()
    return deploy()


if __name__ == "__main__":
    sys.exit(main())
