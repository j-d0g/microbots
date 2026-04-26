# microbots agent skills

Skills are retrieved, not resident. The orchestrator reads this index on
every turn and injects matching skills into the prompt context. This
keeps the system prompt small while giving the agent deep knowledge
when a specific domain comes up.

## Skill catalogue

| Trigger | File | Summary |
|---|---|---|
| `save_workflow`, `run_workflow`, deploy, "how does deploy work" | `deploying-a-workflow.md` | save → confirm → shadow deploy lifecycle |
| `settings`, OAuth, "connect X", credentials, re-auth | `composio-credentials.md` | OAuth flows, token locations, re-auth steps |

## Retrieval rules

1. Match user query + active tool calls against trigger keywords
2. Include at most 2 skills per turn (budget: ~400 tokens total)
3. Skills are appended after the system prompt, before the snapshot
4. If no triggers match, include nothing — don't waste tokens
