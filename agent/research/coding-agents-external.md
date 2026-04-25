# Coding Agents External — Devin & PI

Research agent: R9 (microbots overnight ralph loop)
Date: 2026-04-24

## TL;DR

**PI = Mario Zechner's `pi` (pi.dev / `@mariozechner/pi-coding-agent` / `badlogic/pi-mono`)** — an open-source minimal terminal coding harness in TypeScript with four core tools (read/write/edit/bash) and an RPC/SDK embed surface. It is *not* a hosted SaaS. Confidence: high. Other "PI" candidates (Pi Labs, Pieces, Princeton) are not coding agents.

**Devin** is the right sponsor fit and has a real REST API: `POST /v3/organizations/{org}/sessions` with a `prompt`, returns a session that may produce a PR. Auth is API-key bearer (`cog_*`). Cost ~$2/ACU, ~15 min per ACU. Sessions are slow (minutes–hours) and unreliable (~67% PR merge rate per their own data) — **do NOT live-attempt on stage**. Pre-record one successful run, then trigger a fresh session live as a "look, it's spinning" garnish.

**Outsource the harness?** No. Both tools belong as *peripherals* — Devin as a PR-producing worker behind the microbots scheduler, pi as a self-hostable harness reference — neither replaces the loop. The moat stays.

---

## Devin (Cognition)

### API surface — spec → session → PR

- **Base URL:** `https://api.devin.ai/v3/organizations/{org_id}/...` (v1 also exists at `https://api.devin.ai/v1/sessions`)
- **Auth:** Bearer token, service-user keys prefixed `cog_`. API-key only for now; OAuth shows up on the *consumption* side (Devin authenticating into third-party MCPs like Datadog), not for callers authenticating *into* Devin.
- **Create session (v3):**
  ```
  POST /v3/organizations/{org_id}/sessions
  Authorization: Bearer cog_xxx
  { "prompt": "...", "snapshot_id": "...", "knowledge_ids": [...],
    "playbook_ids": [...], "session_secrets": {...},
    "structured_output_schema": {...} }
  ```
- **Spec passing:** the "spec" *is* the prompt string plus optional `knowledge_ids` (pre-uploaded knowledge entries via Settings → Knowledge) and `playbook_ids` (reusable workflows). For microbots, the natural shape is: render a spec template into the `prompt`, attach a stable knowledge entry that pins repo conventions.
- **PR delivery:** session runs asynchronously; you poll `GET /v3/organizations/{org_id}/sessions/{id}` until status is terminal. Devin opens the PR in the linked GitHub repo via its own GitHub App; the response includes the PR URL. `structured_output_schema` lets you constrain the final payload (e.g. `{file_path, lines_edited, success}`).
- **Latency:** an ACU = ~15 min of agent work. Trivial PR ~1 ACU; non-trivial ~2–4. Plan for 15–60 min wall-clock per session, with long-tail outliers reaching multiple hours.
- **Cost:** Core $2.25/ACU, Team $2.00/ACU. API access requires Team ($500/mo, 250 ACU included) or Enterprise. No surcharge for API calls themselves — only the ACUs they consume.

### MCP surface — wiring SurrealDB into Devin context

Devin operates *both sides* of MCP:

1. **Devin-as-MCP-client:** in a session, Devin can connect to MCP servers configured org-wide. We could stand up a small MCP server in front of microbots' SurrealDB schema (read-only `describe_table`, `list_relations`, `sample_rows`) and register it in Devin Settings. The session would then have schema awareness without us inlining it in the prompt.
2. **Devin-as-MCP-server:** `mcp.devin.ai` exposes Devin sessions/playbooks/knowledge to *other* MCP clients (Claude Code, Cursor). Not relevant to us — that flow inverts our integration.

For the hackathon, skip the MCP server build and just dump the relevant SurrealQL schema chunks into a knowledge entry. Same payoff, near-zero setup time.

### Demo path — live vs pre-record

**Recommend hybrid:** pre-record the happy path, run a live session in parallel, show the recording while the live one cooks.

- **Pure-live risk:** Cognition's own published merge rate is ~67%. Random failure modes documented: stuck loops, hours-long persistence on impossible tasks, removing guardrails to "resolve" self-created conflicts, unpredictable success even on tasks similar to prior wins. A 5-minute demo slot does not survive a 6-hour Devin walkabout.
- **Pure-recorded risk:** judges and the Devin sponsor read it as "they didn't actually integrate."
- **Hybrid script:** "Here's the user accepting an automation suggestion. microbots emits a spec. We hand it to Devin via the API — *click* — session ID `dvn_…` is now running. While that bakes, here's the PR Devin opened during our dry-run twelve hours ago, auto-deployed to Render on merge." The live session is a prop; the recording is the proof.

### Failure modes

- **Session hangs / stuck on action:** Cognition refunds ACUs but the demo is dead. Set a hard wall-clock timeout in our orchestrator (e.g. 20 min) and fall back to a pre-canned PR.
- **Bad PR:** ~33% need rework. For microbots, treat Devin's PR as a *proposal*, not a commit. Render's preview deploy is the pressure test before any merge.
- **Hallucinated changes / removed guardrails:** require a human-merge gate. Never auto-merge Devin PRs in the demo path.
- **Rate-limit / 429:** unlikely at hackathon scale, but cache one good `session_id` as fallback.

---

## PI

### Disambiguation

Candidates considered:
- **Pi Labs / pi.dev** — Mario Zechner's open-source coding agent toolkit. **Match.**
- **Pieces.app** — IDE assistant / snippet manager. Not a coding agent in the harness sense, no current "PI coding agent" branding. Rejected.
- **OpenPI / "pi-coder"** — appear in search noise as alternate names for the same Zechner project. Not separate entities.
- **Princeton / PI-lab open-source** — no recent (2026) coding-agent project under that label. Rejected.
- **Inflection's Pi (pi.ai)** — consumer chatbot, not a coding agent. Rejected.

The Zechner `pi` is the only "PI coding agent" with a 2026 footprint, npm package, GitHub traction (`badlogic/pi-mono`), positive reviews ("ditched Claude Code for pi"), and an embedding/RPC surface — all of which match what a hackathon team would name-drop.

### Brief overview

- **Form factor:** TypeScript monorepo. CLI (`pi`), TUI, print/JSON mode, **RPC mode (JSONL over stdin/stdout)**, and **SDK** (`AgentSession` from `@mariozechner/pi-coding-agent`).
- **Core tools:** read, write, edit, bash. Everything else (sub-agents, plan mode, MCP integration, sandboxing, SSH exec, permission gates) is opt-in via extensions, skills, prompts, or themes — installable from npm.
- **Multi-provider:** Anthropic, OpenAI, Google, Bedrock, Mistral, Groq, Cerebras, xAI, Hugging Face, Azure. Sessions are tree-structured (branchable).
- **Philosophy:** "adapt pi to your workflows, not the other way around." Minimal core, aggressively extensible. Shipped April 2026 with a session runtime API (`createAgentSessionRuntime()`) — actively developed.

### Fit with microbots

Two plausible roles:

1. **Reference architecture for microbots' own harness.** The four-tool minimal core, RPC/SDK embedding, and tree-structured sessions are exactly the design patterns a "harness is the moat" pitch wants to point at. Cite pi as prior art; don't depend on it.
2. **Embedded worker.** If microbots needs a scriptable code-modifying step that we don't want to build, spawning `pi --mode rpc` and feeding it JSONL commands gives us a local, offline, BYO-key coding agent without Devin's latency or per-ACU cost.

Neither role requires committing to pi at the hackathon. There is no sponsor obligation — pi.dev is not a hackathon sponsor (verified: no hackathon mention beyond a creator talk).

---

## Harness-outsourcing analysis

The user's claim — **"the harness is the moat"** — is correct *for microbots' core loop*. Stress-test:

**When outsourcing the harness makes sense:**
- The harness is undifferentiated infrastructure (e.g. a generic VS Code extension wrapping a coding LLM). Then yes, take Cursor/Devin/pi off the shelf.
- The product value is in the *application layer* and the agent loop is incidental.

**When outsourcing fails:**
- The product *is* the agent's behavior — pacing, memory, scheduling, verification, recovery. Microbots' pitch is exactly this: an autonomous loop that schedules and verifies micro-automations. If you outsource the loop, you outsource the differentiation.
- Devin's failure surface (stuck sessions, hallucinated guardrail removal, ~33% bad PRs) is unacceptable as a *primary* control plane. It can be a worker behind a verifier you own — never the verifier itself.
- pi is too thin to *be* the product — it's a foundation, not a service. Adopting pi as the harness means writing the same skills/extensions/permission gates microbots needs to write anyway, in someone else's TypeScript.

**Verdict:** keep the microbots harness. Use Devin as a *bounded peripheral* (PR-producing tool with timeout + verification gate). Cite pi as prior art / inspiration; optionally embed via RPC if a specific narrow code-mod step appears late.

---

## Concrete recommendation for microbots

1. **Honor the Devin sponsor slot, narrowly.** One demo path: user accepts an automation suggestion → microbots emits a spec → `POST /v3/organizations/.../sessions` → poll → Devin's PR lands → Render preview-deploys → human-merge. This is a *stretch* path; do not put it on the critical demo flow.
2. **Pre-record the happy path. Trigger a live session in parallel for theater.** Show the recording. If the live one finishes inside the slot, glory; if it doesn't, no one notices.
3. **Spec-passing shape:** prompt template + one Devin Knowledge entry containing microbots' SurrealQL schema and Render deploy conventions. Skip building a SurrealDB MCP server for this hackathon — knowledge entry is 10x cheaper.
4. **Hard timeout (20 min) with canned-PR fallback.** Never let a Devin session block the demo.
5. **Position pi as inspiration in the README, not a dependency.** "Minimal harness with extensible skills, in the spirit of pi.dev and Claude Code" — earns credibility with judges who recognize the lineage; ships zero coupling.
6. **Do not outsource the loop.** The harness is the moat. Devin is a worker; pi is a reference; microbots is the conductor.

---

## Sources

- [Devin Docs — API Overview](https://docs.devin.ai/api-reference/overview)
- [Devin Docs — Create Session (v3)](https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions)
- [Devin Docs — Create Session (v1)](https://docs.devin.ai/api-reference/v1/sessions/create-a-new-devin-session)
- [Devin Docs — Devin MCP](https://docs.devin.ai/work-with-devin/devin-mcp)
- [Devin Docs — Release Notes 2026](https://docs.devin.ai/release-notes/2026)
- [Devin Pricing](https://devin.ai/pricing/)
- [Lindy — Devin Pricing 2026 breakdown](https://www.lindy.ai/blog/devin-pricing)
- [Cognition — How Cognition Uses Devin to Build Devin](https://cognition.ai/blog/how-cognition-uses-devin-to-build-devin)
- [Cognition — Devin 101: Automatic PR Reviews](https://cognition.ai/blog/devin-101-automatic-pr-reviews-with-the-devin-api)
- [pi.dev](https://pi.dev/)
- [GitHub — badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- [pi-mono — RPC Mode docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)
- [npm — @mariozechner/pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
- [Armin Ronacher — Pi: The Minimal Agent Within OpenClaw](https://lucumr.pocoo.org/2026/1/31/pi/)
- [Metaist — What I learned building an opinionated and minimal coding agent](https://metaist.com/blog/2026/01/pi-coding-agent.html)
