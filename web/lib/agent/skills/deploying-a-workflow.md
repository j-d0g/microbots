# skill: deploying a workflow

## trigger keywords
save_workflow, run_workflow, deploy, shadow, promote, "save it", "run it",
"deploy it", "how does deploy work"

## lifecycle

1. **save_workflow(name, code)** — stages a confirm gate.
   - user sees [confirm] / [hold] buttons
   - voice: "yes" / "save" / "deploy" → confirm. "no" / "hold" → cancel.
   - on confirm: code is persisted to `/api/workflows/{slug}`, window
     shows the deployed URL + byte count.

2. **run_workflow(name, args?)** — also confirm-gated.
   - runs the saved workflow with optional args
   - streams stdout/stderr into the run_workflow window
   - on completion: result object displayed, error if any

3. **shadow deploy** (future):
   - after save_workflow confirms, the service spins up in shadow mode
   - one clean execution cycle → auto-promote to live
   - if the cycle fails, the workflow stays in shadow and the user is notified

## voice shortcuts

- "save it as bug-triage" → save_workflow(name="bug-triage", code=<last run_code output>)
- "run it" → run_workflow(name=<last saved or viewed workflow>)
- "run bug-triage with channel=#ops" → run_workflow(name="bug-triage", args={channel:"#ops"})

## confirm gate rules

- never execute save_workflow or run_workflow without a confirm gate
- if the user pre-confirms ("yes save it"), still stage the gate — the
  user sees the confirmation card and can hold if they change their mind
- timeout: 60s → auto-cancel + toast
