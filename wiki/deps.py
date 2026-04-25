"""WikiDeps — dependency injection for the Pydantic AI wiki agent."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from config import WikiConfig
from db.client import MicrobotsDB


@dataclass
class WikiDeps:
    """Dependencies injected into every wiki agent tool call."""
    db: MicrobotsDB
    memory_root: Path
    config: WikiConfig

    def safe_path(self, rel: str) -> Path:
        """Resolve rel under memory_root and assert it doesn't escape."""
        resolved = (self.memory_root / rel).resolve()
        if not str(resolved).startswith(str(self.memory_root.resolve())):
            raise ValueError(f"Path '{rel}' escapes memory_root")
        return resolved
