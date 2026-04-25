"""Apply schema files to SurrealDB in order."""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from surrealdb import AsyncSurreal

from microbots import get_logger, span

load_dotenv()

SURREAL_URL = os.getenv("SURREAL_URL", "ws://localhost:8000/rpc")
SURREAL_USER = os.getenv("SURREAL_USER", "root")
SURREAL_PASS = os.getenv("SURREAL_PASS", "root")
SURREAL_NS = os.getenv("SURREAL_NS", "microbots")
SURREAL_DB = os.getenv("SURREAL_DB", "memory")

SCHEMA_DIR = Path(__file__).parent
SCHEMA_FILES = sorted(SCHEMA_DIR.glob("*.surql"))

log = get_logger(__name__)


async def apply_schema():
    with span(
        "schema.apply",
        namespace=SURREAL_NS,
        database=SURREAL_DB,
        file_count=len(SCHEMA_FILES),
    ):
        async with AsyncSurreal(SURREAL_URL) as db:
            await db.signin({"username": SURREAL_USER, "password": SURREAL_PASS})
            await db.use(SURREAL_NS, SURREAL_DB)

            for path in SCHEMA_FILES:
                with span("schema.apply.file", filename=path.name):
                    log.info("applying schema file {filename}", filename=path.name)
                    sql = path.read_text()
                    await db.query(sql)
                    log.info("schema file applied {filename}", filename=path.name)

            result = await db.query("INFO FOR DB;")
            tables = list(result[0].get("tables", {}).keys())
            log.info(
                "schema applied — {table_count} tables defined",
                table_count=len(tables),
                tables=tables,
            )


if __name__ == "__main__":
    asyncio.run(apply_schema())
