# Chats — Layer Index

**Parent:** [user.md](../user.md)  
**Layer:** chats (depth 1)  
**Estimated tokens:** ~500

## Overview

5 chat records seeded across 4 integrations. Chats are user-touched content (mid-high signal).

## Chat records

| ID | Title | Source | Signal | Key outcome |
|----|-------|--------|--------|-------------|
| chat:slack_deploy_incident | Deploy failure discussion - microbots staging | slack_thread | high | Added pre-deploy checklist to runbook |
| chat:github_pr_schema | PR #42: Add SurrealDB schema for memory graph | github_pr | high | Bob's review → HNSW dimension + SCHEMAFULL conventions |
| chat:linear_ticket_triage | Bug: memory graph not persisting between sessions | linear_ticket | curated | Docker volume fix, named volumes in docker-compose |
| chat:slack_code_style | Code review preferences discussion | slack_thread | high | Team agreed: type hints, mypy + black via pre-commit |
| chat:notion_deploy_runbook | Deploy Runbook v2 - Notion page edit | notion_page | high | 5-step deploy process documented |

## By source integration

**Slack** (2): deploy incident, code style discussion  
**GitHub** (1): PR #42 schema review  
**Linear** (1): bug ticket for volume mount  
**Notion** (1): deploy runbook update  

## Memories yielded from chats

Each high-signal chat produced distilled memories — see [memories/agents.md](../memories/agents.md) for the full list.

- deploy incident + runbook → notify_deployments memory (confidence 0.95)
- deploy incident → alice_infra memory (confidence 0.88)
- PR #42 review → bob_reviewer, surrealdb_hnsw memories
- slack code style → python_type_hints memory
- linear bug ticket → linear_before_pr memory
