# Slack — Integration Sub-index

**Parent:** [integrations/agents.md](../agents.md)  
**Layer:** integrations/slack (depth 2)  
**Estimated tokens:** ~300

## What Desmond uses Slack for

Primary async communication hub. Used for team coordination, deploy notifications, incident discussions, and quick decisions.

## Key channels

| Channel | Purpose |
|---------|---------|
| #ai-engineering | Primary AI project discussions, microbots updates |
| #deployments | **ALWAYS post here before and after every prod deploy** |
| #general | Company-wide announcements |

## Key people

| Person | Handle | When to reach |
|--------|--------|---------------|
| Alice Chen | @alice | Infrastructure decisions, infra PR reviews |
| Bob Kim | @bob | Code review requests, engineering questions |
| Carol Diaz | @carol | Design coordination, product questions |

## Behavioral patterns

- Use threads for in-depth discussions; keep top-level messages brief
- DM Alice for infra questions, Bob for code reviews
- Check #ai-engineering for project context before starting work
- Deploy notifications: `Deploying [branch] to [env] — [Linear ticket link]`

## Entities appearing in Slack

- @alice, @bob, @carol (people)
- #ai-engineering, #deployments (channels)
- team Engineering

## Related memories

- "Always notify #deployments before and after every production deploy" (confidence: 0.95)
- "Alice is the go-to for infrastructure decisions" (confidence: 0.98)
