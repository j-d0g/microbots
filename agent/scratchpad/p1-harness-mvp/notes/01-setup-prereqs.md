# 01 — Setup prerequisites (audit log)

Captured 2026-04-26 during environment validation, before Phase 0 build.
This is the actual ordered checklist a fresh agent (or a fresh laptop) needs
to complete before any phase work. The handoff doc lists *what* secrets are
needed; this file lists *how* to get the tooling into a working state.

---

## TL;DR — minimum to be agent-ready

```
1. agent/.env  populated with ANTHROPIC_API_KEY, RENDER_API_KEY, COMPOSIO_API_KEY
2. render login                     (interactive: paste device code into browser)
3. render workspace set             (interactive: pick workspace from list)
4. render whoami                    → prints name+email
5. render workspace current         → prints workspace + ID
6. render services                  → returns (empty is fine)
```

If steps 4–6 all return cleanly, the environment is ready for the Phase-0 agent.

---

## Step-by-step with rationale

### 1. `.env` location and keys

**Where:** `agent/.env` (inside the worktree). **Not** the repo root `microbots/.env`.
Repo root `.env` is Desmond's knowledge-graph track and has different keys.

**Required keys** (populated values needed):

```
ANTHROPIC_API_KEY=sk-ant-...
RENDER_API_KEY=rnd_...
COMPOSIO_API_KEY=ak_...
```

**Optional / deferred:**

- `OPENROUTER_API_KEY` — only if swapping LLM provider
- `LOGFIRE_TOKEN` — only if lifting `microbots/log.py`
- `DOCKER_USER` / `DOCKER_ORG` / `DOCKER_TOKEN` — **NOT NEEDED for P1**.
  These are only used by `microbots/render_sdk/` for image push, and the
  handoff (D-finding in `01-findings.md`) explicitly says we are **not** lifting
  `render_sdk/`. We deploy via `render workflows init` + git push instead.
- `SURREAL_*` — Desmond's knowledge-graph track, ignore.

### 2. `render login`

Interactive device-auth flow:

```
$ render login
Open in browser: https://render.com/cli-login
Code: XXXX-XXXX-XXXX-XXXX
```

The 16-char code is **not an API key** — it's a one-time pairing code (~5 min TTL).
Paste it into the browser page, approve the session in the Render dashboard,
and the CLI terminal unblocks with "Logged in as ...".

**Why it's separate from `RENDER_API_KEY`:** the `render` CLI uses its own
browser-OAuth session, not the env var. The env var is for SDKs/scripts
(e.g. `render_sdk` Python package) hitting the REST API headlessly.

**If the code expires** before you paste it: just re-run `render login`.

### 3. `render workspace set` ← easy to miss

Even after `render login` succeeds, the CLI is in a no-workspace state and
**every command except `whoami` will fail** with:

```
Error: no workspace set. Use `render workspace set` to set a workspace
```

`render workspace set` opens an interactive picker:

```
┏━━━━━━━━━━━━┳━━━━━━━━━━━┳────────────────────────┓
┃Name        ┃Email      ┃ID                      ┃
┣━━━━━━━━━━━━╋━━━━━━━━━━━╋────────────────────────┫
┃My Workspace┃...        ┃tea-xxxxxxxxxxxxxxx     ┃
┗━━━━━━━━━━━━┻━━━━━━━━━━━┻────────────────────────┛
```

Press Enter to select. There is no obvious non-interactive flag in the
picker UI; if you need it scripted, capture the workspace ID from
`render workspace current` once set.

### 4–6. Verification commands

```
render whoami             # account level — works after login
render workspace current  # workspace level — works after `workspace set`
render services -o text   # API access via workspace — empty is fine
render workflows list -o text
```

All four must return without "no workspace set" or "run `render login`" errors.

---

## Why this audit exists

The original `plan/03-handoff.md` "External services + secrets" section listed
the API keys but did not document:

- That `.env` lives at `agent/.env`, not repo root
- That `render login` is required and uses a *device code*, not the API key
- That `render workspace set` is a separate required step after login
- That Docker creds in `.env.example` are not needed for P1

A fresh agent would hit the workspace-not-set error mid-Phase-0 and lose time
debugging. Logging it here so the handoff stays accurate.

---

## Tooling versions confirmed working

```
render CLI    v2.15.1
python        3.14.3
node          25.8.1
npm           11.11.0
uv            0.10.10
```

Render CLI 2.15.1 has the `workflows` subcommand
(`init / dev / list / runs / tasks / versions`).
