"""Token budget helpers for wiki targets."""
from __future__ import annotations

from pathlib import Path

# Default token budgets by path pattern
_BUDGETS: dict[str, int] = {
    "user.md": 4000,
    "integrations/agents.md": 600,
    "entities/agents.md": 600,
    "chats/agents.md": 600,
    "memories/agents.md": 600,
    "skills/agents.md": 600,
    "workflows/agents.md": 600,
}

_SUBLAYER_BUDGET = 300
_DEFAULT_BUDGET = 600


def budget_for(path: Path, memory_root: Path) -> int:
    """Return the token budget for a given markdown path."""
    rel = str(path.relative_to(memory_root))
    # Exact match
    if rel in _BUDGETS:
        return _BUDGETS[rel]
    # user.md
    if rel == "user.md":
        return 4000
    # Layer agents.md (depth 2: layer/agents.md)
    parts = Path(rel).parts
    if len(parts) == 2 and parts[1] == "agents.md":
        return _BUDGETS.get("integrations/agents.md", _DEFAULT_BUDGET)
    # Sub-layer agents.md (depth 3: layer/sub/agents.md)
    if len(parts) == 3 and parts[2] == "agents.md":
        return _SUBLAYER_BUDGET
    return _DEFAULT_BUDGET
