# Workflows — Layer Index

**Parent:** [user.md](../user.md)  
**Layer:** workflows (depth 1)  
**Estimated tokens:** ~350

## Overview

3 workflows seeded. Workflows are multi-step processes composed of ordered skills, spanning multiple integrations.

## Workflow records

| ID | Name | Trigger | Frequency |
|----|------|---------|-----------|
| workflow:deploy_pipeline | Deploy Pipeline | Feature branch ready to merge | daily |
| workflow:bug_triage | Bug Triage | Bug reported in Slack or Linear | weekly |
| workflow:pr_review_cycle | PR Review Cycle | Starting new feature or bug fix | daily |

## Workflow details

### Deploy Pipeline
**Trigger:** Feature branch is ready to merge to main  
**Outcome:** Code live in production, team notified in #deployments, Linear ticket closed  
**Tools:** Slack, GitHub, Linear  
**Key entities:** #deployments channel, Alice (approver), microbots repo

**Steps (ordered skills):**
1. [step 1] deploy_to_staging
2. [step 2, optional] create_linear_from_slack

**Informing memories:** notify_deployments, alice_infra

---

### Bug Triage
**Trigger:** Bug reported in Slack or Linear  
**Outcome:** Bug fixed and deployed, Linear ticket closed, team updated in Slack  
**Tools:** Slack, Linear, GitHub  
**Key entities:** Alice (escalation), #ai-engineering (notifications)

**Steps (ordered skills):**
1. [step 1] triage_incoming_bug
2. [step 2] create_linear_from_slack
3. [step 3, optional] deploy_to_staging

---

### PR Review Cycle
**Trigger:** Starting work on a new feature or bug fix  
**Outcome:** Feature merged to main, Linear ticket closed, PR linked  
**Tools:** GitHub, Linear  
**Key entities:** Bob (reviewer), microbots repo

**Steps (ordered skills):**
1. [step 1] review_pr_checklist
2. [step 2] create_linear_from_slack

**Informing memories:** linear_before_pr, bob_reviewer
