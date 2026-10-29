from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest
from dotenv import load_dotenv
from surrealdb import AsyncSurreal

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = ROOT / "knowledge_graph" / "schema"

load_dotenv(ROOT / ".env")
os.environ["SURREAL_DB"] = "memory_test"


async def _prepare_test_database() -> None:
    async with AsyncSurreal(os.getenv("SURREAL_URL", "ws://localhost:8000/rpc")) as db:
        await db.signin(
            {
                "username": os.getenv("SURREAL_USER", "root"),
                "password": os.getenv("SURREAL_PASS", "root"),
            }
        )
        await db.use(os.getenv("SURREAL_NS", "microbots"), "memory_test")
        for schema_file in sorted(SCHEMA_DIR.glob("*.surql")):
            await db.query(schema_file.read_text(encoding="utf-8"))


@pytest.fixture(scope="session", autouse=True)
def prepare_test_database():
    asyncio.run(_prepare_test_database())
