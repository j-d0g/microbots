# Agent Tool Reference

The agent receives a global canvas tool set and focused tools for the most
recently opened card. Canvas state is shared between the browser and server.
Opening a card focuses it; opening the same kind again updates its payload and
moves it to the top.

## Canvas tools

- `open_window({ kind, focus? })` opens a card. `kind` is one of `graph`,
  `ask_user`, `integrations`, `integration_detail`, `entities`,
  `entity_detail`, `memories`, `skills`, `workflows`, or `composio_connect`.
  Omit `focus` unless a specific node, entity, or workflow should be centred.
- `close_window({ id?, kind? })` closes a selected card, or the focused card
  when no selector is supplied.
- `focus_window({ id?, kind? })` brings an open card to the foreground.
- `clear_canvas({})` closes every open card.

Focused tool bags are defined in `web/lib/agent/window-tools/`:

| Card kind | Tool family |
|---|---|
| `ask_user` | `askuser_*` |
| `composio_connect` | `composio_connect_*` |
| `entities` | `entities_*` |
| `entity_detail` | `entity_detail_*` |
| `graph` | `graph_*` |
| `integration_detail` | `integration_detail_*` |
| `integrations` | `integrations_*` |
| `memories` | `memories_*` |
| `skills` | `skills_*` |
| `workflows` | `workflows_*` |

## Knowledge graph writes

The knowledge graph write tools are `add_memory`, `upsert_entity`,
`upsert_skill`, `upsert_workflow`, `add_chat`, `write_wiki_page`, and
`update_user`. Successful writes report their result in the tool trace; they
do not open a separate view.
