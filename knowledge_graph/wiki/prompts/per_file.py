"""Per-page user prompt template for the wiki agent."""
from __future__ import annotations

import json
from typing import Any


def render_user_prompt(
    path: str,
    existing_content: str,
    graph_slice: list[dict[str, Any]],
    token_budget: int,
    parent_path: str | None = None,
) -> str:
    graph_json = json.dumps(graph_slice, default=str, indent=2)[:8000]
    parent_hint = (
        f"This page's parent is `{parent_path}`. Include a `> Parent: [{parent_path}]({parent_path})` link near the top.\n"
        if parent_path
        else "This is the root page (`user.md`); it has no parent link.\n"
    )

    return f"""\
## Task: update wiki page `{path}`

**Token budget:** {token_budget} tokens.
{parent_hint}

**Existing content** (empty if the page hasn't been written yet):
```markdown
{existing_content or "(empty)"}
```

**Graph slice** (live data from SurrealDB):
```json
{graph_json}
```

Instructions (follow exactly, no extra steps):

1. Treat the graph slice above as authoritative — do not invent data.
2. If one specific detail is missing and critical, call `query_graph` **once** and only once. Otherwise skip.
3. Draft the markdown in your head. Stay within the {token_budget}-token budget.
4. Call `write_markdown` exactly once with `path="{path}"` and the final content (and a one-sentence `rationale`).
5. Return `WikiUpdate` with `path="{path}"`, `content=<the same content you wrote>`, and the same one-sentence `rationale`.

Do not call `read_markdown`, `list_markdown_tree`, or `estimate_tokens`. The graph slice and existing content above are sufficient.
"""
