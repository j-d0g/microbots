"""Pytest configuration and fixtures for the microbots test suite.

Provides an ephemeral SurrealDB session per test (Docker-based).
The DB container must be running (docker compose up -d) before running tests.
Set SURREAL_TEST_PORT to override the port (default: same as SURREAL_PORT).
"""
from __future__ import annotations

import asyncio
import os
import random
from pathlib import Path

import pytest
import pytest_asyncio
from surrealdb import AsyncSurreal

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIR = ROOT / "schema"

# Test DB uses a fixed namespace with per-test random DB names to avoid cross-test pollution
TEST_NS = "microbots_test"


def _surreal_url() -> str:
    port = os.getenv("SURREAL_TEST_PORT", os.getenv("SURREAL_PORT", "8000"))
    return f"ws://localhost:{port}/rpc"


def _test_db_name() -> str:
    return f"test_{random.randint(10000, 99999)}"


async def _apply_schema(db: AsyncSurreal) -> None:
    for schema_file in sorted(SCHEMA_DIR.glob("*.surql")):
        surql = schema_file.read_text(encoding="utf-8")
        try:
            await db.query(surql)
        except Exception as e:
            print(f"[conftest] Schema warning for {schema_file.name}: {e}")


@pytest.fixture(scope="session")
def event_loop():
    """Session-scoped event loop for async fixtures."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def test_db():
    """Ephemeral SurrealDB connection for one test function.

    Creates a unique DB name, applies schema, tears down after.
    The db_name is stored as ``test_db._test_db_name`` for use by paired fixtures.
    """
    db_name = _test_db_name()
    surreal_url = _surreal_url()
    surreal_user = os.getenv("SURREAL_USER", "root")
    surreal_pass = os.getenv("SURREAL_PASS", "root")

    async with AsyncSurreal(surreal_url) as db:
        await db.signin({"username": surreal_user, "password": surreal_pass})
        await db.use(TEST_NS, db_name)
        await _apply_schema(db)
        # Stash the names so paired fixtures can build a Config pointing at this DB.
        db._test_db_name = db_name  # type: ignore[attr-defined]
        db._test_ns = TEST_NS  # type: ignore[attr-defined]
        db._test_url = surreal_url  # type: ignore[attr-defined]
        yield db
        # Teardown: remove the ephemeral DB
        try:
            await db.query(f"REMOVE DATABASE `{db_name}`")
        except Exception:
            pass


@pytest_asyncio.fixture(scope="function")
async def microbots_db(test_db):
    """Wrap raw AsyncSurreal in MicrobotsDB for named-query tests."""
    from db.client import MicrobotsDB
    yield MicrobotsDB(test_db)


@pytest.fixture
def test_db_config(test_db):
    """Config wired to the *same* ephemeral DB as test_db.

    Use this when a subsystem (e.g. wiki orchestrator) needs to open its own
    connection to the test DB — the ns/db names match test_db exactly.
    """
    from config import Config, WikiConfig
    return Config(
        surreal_url=test_db._test_url,
        surreal_user=os.getenv("SURREAL_USER", "root"),
        surreal_password=os.getenv("SURREAL_PASS", "root"),
        surreal_ns=test_db._test_ns,
        surreal_db=test_db._test_db_name,
        wiki=WikiConfig(write_dry_run=False),
    )


@pytest.fixture
def test_config(tmp_path):
    """Standalone Config pointing at a fresh (independent) test DB.

    Use for unit tests that spin up their own connection; does NOT share
    state with test_db. For a paired Config use test_db_config.
    """
    from config import Config, WikiConfig
    db_name = _test_db_name()
    return Config(
        surreal_url=_surreal_url(),
        surreal_user=os.getenv("SURREAL_USER", "root"),
        surreal_password=os.getenv("SURREAL_PASS", "root"),
        surreal_ns=TEST_NS,
        surreal_db=db_name,
        wiki=WikiConfig(write_dry_run=True),
    )


@pytest.fixture
def memory_root(tmp_path) -> Path:
    """Temporary memory/ directory for wiki tests."""
    root = tmp_path / "memory"
    root.mkdir()
    for layer in ("integrations", "entities", "chats", "memories", "skills", "workflows"):
        (root / layer).mkdir()
    return root


@pytest.fixture
def fixtures_dir() -> Path:
    return ROOT / "tests" / "fixtures"


@pytest.fixture
def train_dir() -> Path:
    return ROOT / "tests" / "fixtures" / "train"


@pytest.fixture
def holdout_dir() -> Path:
    return ROOT / "tests" / "fixtures" / "holdout"
