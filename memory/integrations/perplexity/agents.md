# Perplexity — Integration Sub-index

**Parent:** [integrations/agents.md](../agents.md)  
**Layer:** integrations/perplexity (depth 2)  
**Estimated tokens:** ~200

## What Desmond uses Perplexity for

Web-grounded answers with citations, quick API and library checks, and long-running **async Sonar** jobs when a question needs more depth than a short back-and-forth.

## Use cases

- **API and library behavior** — confirm semantics before implementing or reviewing a PR
- **Async Sonar** — multi-step research (e.g. HNSW parameters, SurrealDB vector index options) with full responses and sources
- **Specs and ADRs** — pull cited material into Notion or Linear ticket context

## Navigation tips

- Async job history lists recent Sonar work; open completed jobs for the full response
- Prefer explicit product names, versions, and dates in prompts for better retrieval
- For PR review, cross-check unfamiliar APIs the same way you would official docs (Perplexity surfaces citations to follow)

## Behavioral patterns

- Run Sonar for deep research; use sync chat for fast checks
- Share Perplexity links in Slack when the team needs the same citation set
- Cross-check surprising API behavior against official docs linked in citations
