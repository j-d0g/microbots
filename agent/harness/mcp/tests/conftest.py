"""Shared fixtures for MCP server unit tests.

The server module is imported once at the package level (it has no expensive
top-level work other than ``SAVED_DIR.mkdir``). Each test gets its own
isolated ``SAVED_DIR`` via the ``server`` fixture, which monkeypatches the
module-level ``SAVED_DIR`` to a ``tmp_path``-rooted directory and tears it
back down at the end. This keeps tests hermetic without needing to reload
the module per test.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest

# Ensure the MCP package directory (which contains ``server.py``) is on
# ``sys.path`` so ``import server`` works regardless of the cwd from which
# pytest is invoked.
_MCP_DIR = Path(__file__).resolve().parent.parent
if str(_MCP_DIR) not in sys.path:
    sys.path.insert(0, str(_MCP_DIR))


@pytest.fixture
def server(tmp_path, monkeypatch):
    """Import ``server`` with ``SAVED_DIR`` pointed at a temp directory.

    Yields the module so each test can call its tools / helpers directly.
    """
    # Make sure required env vars are set to harmless values *before* import
    # so the module-level config block doesn't pick up real credentials from
    # the developer's shell.
    monkeypatch.setenv("MCP_API_TOKEN", "test-token")
    monkeypatch.delenv("RENDER_EXTERNAL_HOSTNAME", raising=False)
    monkeypatch.delenv("RENDER_API_KEY", raising=False)

    # Import (or re-use) the module, then redirect SAVED_DIR.
    if "server" in sys.modules:
        mod = importlib.reload(sys.modules["server"])
    else:
        mod = importlib.import_module("server")

    saved = tmp_path / "saved"
    saved.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(mod, "SAVED_DIR", saved)

    # Defensive: clear any cached render client between tests.
    monkeypatch.setattr(mod, "_render_client", None, raising=False)

    yield mod
