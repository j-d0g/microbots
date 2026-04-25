"""Per-file user prompt templates for the wiki agent."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def render_user_prompt(
    path: Path,
    memory_root: Path,
    existing_content: str,
    graph_slice: list[dict[str, Any]],
    token_budget: int,
) -> str:
    rel = str(path.relative_to(memory_root))
    graph_json = json.dumps(graph_slice, default=str, indent=2)[:8000]  # hard cap for context

    return f"""\
## Task: update `{rel}`

**Token budget:** {token_budget} tokens  
**Existing content** (empty string if new file):
```markdown
{existing_content or "(empty)"}
```

**Graph slice** (live data from SurrealDB):
```json
{graph_json}
```

Instructions (follow exactly in this order, no extra steps):

1. Read the graph slice above — it is the authoritative data for this file.
2. If one specific detail is missing and critical, call `query_graph` **once** for it. Otherwise skip.
3. Write the updated markdown in your head. Keep within the {token_budget}-token budget.
4. Call `write_markdown` exactly once with path=`{rel}` and the final content.
5. Return `WikiUpdate` with `path="{rel}"`, `content=<the same content you wrote>`, and a one-sentence `rationale`.

Do not call `read_markdown`, `list_markdown_tree`, or `estimate_tokens` — the graph slice above is sufficient.
"""
