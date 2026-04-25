"""WikiDeps — dependency injection for the Pydantic AI wiki agent."""
from __future__ import annotations

from dataclasses import dataclass

from config import WikiConfig
from db.client import MicrobotsDB


@dataclass
class WikiDeps:
    """Dependencies injected into every wiki agent tool call.

    Wiki state lives entirely in SurrealDB; there is no filesystem path
    sandbox — `MicrobotsDB.write_wiki_page` rejects unknown paths because the
    set of pages is schema-driven (see schema/04_wiki_seed.surql).
    """
    db: MicrobotsDB
    config: WikiConfig
