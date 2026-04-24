# Integrations — Layer Index

**Parent:** [user.md](../user.md)  
**Layer:** integrations (depth 1)  
**Estimated tokens:** ~600

## Overview

5 integrations seeded. Desmond uses all of them daily except Notion (weekly).

| Integration | Slug | Category | Frequency | Sub-index |
|-------------|------|----------|-----------|-----------|
| Slack | slack | communication | daily | [slack/agents.md](slack/agents.md) |
| GitHub | github | code | daily | [github/agents.md](github/agents.md) |
| Linear | linear | project_mgmt | daily | [linear/agents.md](linear/agents.md) |
| Gmail | gmail | communication | daily | [gmail/agents.md](gmail/agents.md) |
| Notion | notion | knowledge | weekly | [notion/agents.md](notion/agents.md) |

## Co-usage patterns

Integrations most frequently used together:

| Pair | Context | Frequency |
|------|---------|-----------|
| GitHub ↔ Linear | PR workflow (every PR links to a ticket) | 200 |
| Slack ↔ Linear | Triage (Slack reports become Linear tickets) | 150 |
| Slack ↔ GitHub | Deploy coordination and PR review pings | 120 |
| Slack ↔ Notion | Sharing docs in Slack for context | 40 |
| Linear ↔ Notion | Linking specs to tickets | 30 |

## Behavioral summary per integration

**Slack** — Primary async hub. Channels: #ai-engineering, #deployments, #general. Always post to #deployments before/after deploys.

**GitHub** — Code, PRs, CI. Repos: microbots, taro-api, infra. Bob is primary reviewer. Tag Alice for infra PRs.

**Linear** — Task tracking. Projects: "Agent Memory" (microbots), "Platform" (infra/API). Always create ticket before starting work.

**Gmail** — External only. Investor updates, vendor coordination, legal. Check once daily.

**Notion** — Long-form docs. Architecture decisions, meeting notes, product specs. Link specs in Linear tickets.
