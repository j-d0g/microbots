# Skills — Layer Index

**Parent:** [user.md](../user.md)  
**Layer:** skills (depth 1)  
**Estimated tokens:** ~450

## Overview

4 skills seeded. Skills are repeatable atomic behaviors Desmond performs — learned from observed chat patterns.

## Skill records

| ID | Name | Frequency | Integrations |
|----|------|-----------|-------------|
| skill:create_linear_from_slack | Create Linear ticket from Slack message | daily | Slack, Linear |
| skill:deploy_to_staging | Deploy to staging | daily | Slack, GitHub |
| skill:triage_incoming_bug | Triage incoming bug | weekly | Slack, Linear |
| skill:review_pr_checklist | Review PR with checklist | daily | GitHub, Linear, Perplexity |

## Skill details

### Create Linear ticket from Slack message
When a bug or task is raised in Slack, create a Linear ticket with full context.
1. Read Slack message and extract task/bug description
2. Open Linear, select project (Agent Memory or Platform)
3. Create ticket with descriptive title and context
4. Set priority (Urgent for blockers, High for sprint goals)
5. Assign to self or appropriate team member
6. Reply in Slack thread with Linear ticket link

### Deploy to staging
1. Post to #deployments: "Deploying [branch] to staging — [Linear ticket link]"
2. Push branch and trigger CI
3. Wait for CI green
4. Run smoke tests against staging
5. Post to #deployments: "Staging deploy complete — [status]"

### Triage incoming bug
1. Read bug report in Slack or Linear
2. Check recent logs or error traces
3. Classify severity: P0 (prod down), P1 (major feature broken), P2 (minor)
4. Create or update Linear ticket with findings
5. Assign to appropriate engineer
6. Post update to #ai-engineering or #deployments

### Review PR with checklist
1. Check PR description links to a Linear ticket
2. For unfamiliar dependencies or APIs, verify current behavior in Perplexity (citations) before a deep line-by-line pass
3. Verify all Python functions have type hints
4. Check tests exist for new functionality
5. For SurrealDB changes: verify SCHEMAFULL, HNSW dimensions, index correctness
6. Run CI and confirm all checks pass
7. Approve or request changes with specific, actionable comments

## Skill provenance (derived from chats)

- create_linear_from_slack ← slack_deploy_incident, linear_ticket_triage
- deploy_to_staging ← slack_deploy_incident, notion_deploy_runbook
- triage_incoming_bug ← linear_ticket_triage
- review_pr_checklist ← github_pr_schema, slack_code_style
