# Memories — Layer Index

**Parent:** [user.md](../user.md)  
**Layer:** memories (depth 1)  
**Estimated tokens:** ~400

## Overview

6 memories seeded. Memories are high-signal distilled knowledge — preferences, facts, and action patterns extracted from chats.

## Memory records

| ID | Type | Confidence | Summary |
|----|------|-----------|---------|
| memory:notify_deployments | preference | 0.95 | Always post to #deployments before and after every production deploy |
| memory:alice_infra | fact | 0.98 | Alice Chen is the go-to for all infrastructure decisions |
| memory:linear_before_pr | action_pattern | 0.92 | Always create a Linear ticket before opening a GitHub PR |
| memory:python_type_hints | preference | 0.90 | All Python functions must have type hints; mypy + black enforced |
| memory:bob_reviewer | fact | 0.88 | Bob Kim is primary reviewer: focuses on type safety, SCHEMAFULL, HNSW dimensions |
| memory:surrealdb_hnsw | fact | 0.95 | HNSW DIMENSION must match embedding model (1536); mismatch causes silent failures (reinforced by Perplexity research) |

## By memory type

**Preferences (2):** notify_deployments, python_type_hints  
**Facts (3):** alice_infra, bob_reviewer, surrealdb_hnsw  
**Action patterns (1):** linear_before_pr  

## High-confidence memories (≥ 0.90)

1. alice_infra (0.98) — Alice for infra decisions
2. notify_deployments (0.95) — #deployments convention
3. surrealdb_hnsw (0.95) — HNSW dimension check
4. linear_before_pr (0.92) — Linear ticket before PR
5. python_type_hints (0.90) — type hints + mypy

## What memories inform

- **deploy_pipeline workflow** ← notify_deployments, alice_infra
- **pr_review_cycle workflow** ← linear_before_pr, bob_reviewer, surrealdb_hnsw
- **deploy_to_staging skill** ← notify_deployments
- **create_linear_from_slack skill** ← linear_before_pr
- **review_pr_checklist skill** ← surrealdb_hnsw (Perplexity supports API/library checks during review)
