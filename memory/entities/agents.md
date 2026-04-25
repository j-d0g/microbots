# Entities — Layer Index

**Parent:** [user.md](../user.md)  
**Layer:** entities (depth 1)  
**Estimated tokens:** ~700

## Overview

10 entities seeded. Entities are first-class cross-integration nodes — a person or resource that exists across multiple tools.

## People

| Entity ID | Name | Role | Integrations |
|-----------|------|------|-------------|
| entity:alice | Alice Chen | Co-founder, infra lead | Slack (@alice), GitHub (alice-chen), Linear |
| entity:bob | Bob Kim | Senior AI engineer, primary reviewer | Slack (@bob), GitHub (bob-kim), Linear, Perplexity (research during review) |
| entity:carol | Carol Diaz | Product designer | Slack (@carol), Linear |

**Key facts:**
- Alice is the decision-maker for all infrastructure questions
- Bob is the primary code reviewer for microbots and taro-api
- Carol owns design tasks in Linear

## Channels

| Entity ID | Name | Integration | Purpose |
|-----------|------|-------------|---------|
| entity:channel_ai_eng | #ai-engineering | Slack | Primary AI project discussions |
| entity:channel_deployments | #deployments | Slack | Deploy notifications (post before + after every deploy) |

## Repositories

| Entity ID | Name | Integration | Purpose |
|-----------|------|-------------|---------|
| entity:repo_microbots | microbots | GitHub, Perplexity | Primary active project (agent memory); vector and schema research in context of this repo |
| entity:repo_taro_api | taro-api | GitHub | Backend API service |

## Projects

| Entity ID | Name | Integration | Scope |
|-----------|------|-------------|-------|
| entity:project_agent_memory | Agent Memory | Linear | All microbots work |
| entity:project_platform | Platform | Linear | Infra and API work |

## Teams

| Entity ID | Name | Integrations | Members |
|-----------|------|-------------|---------|
| entity:team_engineering | Engineering | Slack, GitHub, Linear, Perplexity | Alice, Bob, Carol, Desmond |

## Cross-entity relationships

- Alice, Bob, Carol, Desmond → member of Engineering team
- Alice → maintains microbots (infra PRs)
- Bob → maintains microbots and taro-api (primary reviewer)
- Agent Memory project → tracks microbots repo
