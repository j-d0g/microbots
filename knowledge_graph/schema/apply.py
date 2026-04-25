"""Apply schema files to SurrealDB in order."""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from surrealdb import AsyncSurreal

load_dotenv()

SURREAL_URL = os.getenv("SURREAL_URL", "ws://localhost:8000/rpc")
SURREAL_USER = os.getenv("SURREAL_USER", "root")
SURREAL_PASS = os.getenv("SURREAL_PASS", "root")
SURREAL_NS = os.getenv("SURREAL_NS", "microbots")
SURREAL_DB = os.getenv("SURREAL_DB", "memory")

SCHEMA_DIR = Path(__file__).parent
SCHEMA_FILES = sorted(SCHEMA_DIR.glob("*.surql"))


async def apply_schema():
    async with AsyncSurreal(SURREAL_URL) as db:
        await db.signin({"username": SURREAL_USER, "password": SURREAL_PASS})
        await db.use(SURREAL_NS, SURREAL_DB)

        for path in SCHEMA_FILES:
            print(f"Applying {path.name}...")
            sql = path.read_text()
            await db.query(sql)
            print(f"  ✓ {path.name} applied.")

        print("\nSchema applied successfully.")


if __name__ == "__main__":
    asyncio.run(apply_schema())
