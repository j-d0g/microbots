# GitHub — Integration Sub-index

**Parent:** [integrations/agents.md](../agents.md)  
**Layer:** integrations/github (depth 2)  
**Estimated tokens:** ~300

## What Desmond uses GitHub for

Code collaboration, PR reviews, and CI pipeline management.

## Key repositories

| Repo | Purpose | Primary reviewer |
|------|---------|-----------------|
| microbots | Agent memory infrastructure (active) | Bob Kim |
| taro-api | Backend API service (FastAPI + PostgreSQL) | Bob Kim |
| infra | Terraform and Docker configs | Alice Chen |

## Behavioral patterns

- Always link a Linear ticket in the PR description
- Open PRs from feature branches, request review from Bob
- Check CI status before merging
- Tag Alice on infra-touching PRs (infra repo or Docker/Terraform changes)

## PR review standards (from Bob)

- All Python functions must have type hints
- SCHEMAFULL on all SurrealDB tables
- HNSW dimension must match embedding model (1536 for OpenAI-compatible)
- Tests required for new functionality
- Linear ticket link in PR description required

## Entities appearing in GitHub

- bob-kim (reviewer), alice-chen (maintainer)
- repos: microbots, taro-api, infra
- team: Engineering

## Related memories

- "Bob Kim is the primary reviewer — prioritizes type safety, SCHEMAFULL, HNSW dimensions" (confidence: 0.88)
- "Always verify HNSW DIMENSION matches embedding model" (confidence: 0.95)
