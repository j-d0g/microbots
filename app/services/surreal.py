"""Shared SurrealDB session helper + JSON normaliser.

Used by both the MCP tool layer (`app/mcp/*`) and the REST route layer
(`app/routes/api_kg.py`). Keeping the session helper and the JSON-normalisation
logic in one place means we only need to maintain one set of SurrealDB quirks.
"""

from __future__ import annotations

import datetime as _dt
import json as _json
import os
from contextlib import asynccontextmanager
from decimal import Decimal as _Decimal
from typing import Any, AsyncIterator, Optional
from uuid import UUID as _UUID

from surrealdb import AsyncSurreal


def _env(name: str, default: Optional[str] = None) -> str:
    """Return an env var or raise a clear error if missing."""
    v = os.environ.get(name, default)
    if v is None:
        raise RuntimeError(f"{name} is not set in the environment")
    return v


@asynccontextmanager
async def session() -> AsyncIterator[AsyncSurreal]:
    """Open a one-shot SurrealDB session for a single request.

    A fresh connection per request is simpler and more resilient than holding a
    long-lived WebSocket for every concurrent user. The overhead is ~50–150 ms
    which is fine for interactive agent use. Optimise with a pool later if
    metrics demand it.
    """
    url = _env("SURREAL_URL")
    user = _env("SURREAL_USER")
    pwd = _env("SURREAL_PASS")
    ns = _env("SURREAL_NS", "microbots")
    db = _env("SURREAL_DB", "memory")
    async with AsyncSurreal(url) as s:
        await s.signin({"username": user, "password": pwd})
        await s.use(ns, db)
        yield s


# ── JSON normalisation ──────────────────────────────────────────────────────
# SurrealDB v3 returns native types (RecordID, datetime) that aren't directly
# JSON-serialisable. FastMCP and FastAPI both surface this as confusing
# errors. We normalise once at the boundary — everything downstream sees
# plain dicts/lists/strings.


def jsonify(obj: Any) -> Any:
    """Recursively convert Surreal-native types to JSON-safe primitives."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {k: jsonify(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonify(x) for x in obj]
    if isinstance(obj, _dt.datetime):
        return obj.isoformat()
    if isinstance(obj, _dt.date):
        return obj.isoformat()
    if isinstance(obj, (_Decimal, _UUID)):
        return str(obj)
    cls = type(obj).__name__
    if cls in ("RecordID", "RecordIdKey", "Table", "Range", "Bytes", "Future", "Geometry"):
        return str(obj)
    return str(obj)


async def q(s: AsyncSurreal, surql: str, params: Optional[dict] = None) -> list[dict[str, Any]]:
    """Run a query, return normalised list of dict rows.

    Used by both REST and MCP layers. REST layer returns this directly
    (FastAPI JSON-encodes it). MCP layer wraps with ``json.dumps`` (FastMCP
    tool return type is ``str``).
    """
    rows = await s.query(surql, params or {})
    if rows is None:
        return []
    out = jsonify(rows)
    return out if isinstance(out, list) else [out]


async def q_one(s: AsyncSurreal, surql: str, params: Optional[dict] = None) -> dict[str, Any]:
    """Run a query that should yield a single row; return that row (or {})."""
    rows = await s.query(surql, params or {})
    if rows is None:
        return {}
    out = jsonify(rows)
    if isinstance(out, list):
        return out[0] if out else {}
    return out if isinstance(out, dict) else {}


def dumps(obj: Any) -> str:
    """Shortcut for ``json.dumps(jsonify(obj), indent=2)`` — used by MCP tools."""
    return _json.dumps(jsonify(obj), indent=2, default=str)
