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

Using the tools available (`query_graph`, `estimate_tokens`, `read_markdown`, `write_markdown`):

1. Review the existing content and the graph slice above.
2. Fetch any additional graph data you need via `query_graph`.
3. Draft the updated markdown. Validate parent links and token budget.
4. Call `write_markdown` with the final content.
5. Return a `WikiUpdate` with `path="{rel}"`, `content=<final>`, and a brief `rationale`.
"""
