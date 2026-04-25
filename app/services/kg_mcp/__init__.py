"""kg_mcp — Model Context Protocol server exposing the microbots knowledge graph.

Wraps the whitelisted named queries from `knowledge_graph/db/queries.py` as
@mcp.tool() functions, served over streamable HTTP. Designed to be deployed
as its own Render web service via `render_sdk.deploy()`.

Read the full design in `docs/ux-plan.md` and the architectural rationale
in the conversation that produced this file.
"""
