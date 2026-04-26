# README validation — fresh-eyes run

Worktree: `/Users/jordantran/Agemo/microbots/agent/.worktrees/jordan-merge-harness-with-frontend`
Doc validated: `web/README.md`
Tooling on host: Node 25.x, npm 11.x, Next 16.2.4 (Turbopack)

## Verdict

**PARTIAL** — Both scenarios eventually produced a `200` and a working agent stream, but Scenario 1 was blocked by a hard wall the README does not acknowledge (Next.js 16 dev-lock when another dev server is already attached to the same `web/` directory), and Scenario 2 has no story at all for where an unfamiliar contributor finds an OpenRouter key beyond "go sign up." A fresh contributor following the README literally cannot finish either scenario on this machine without deviating.

## Scenario 1 — mock agent

Goal: run dev server with default `.env.example` (`NEXT_PUBLIC_MOCK_AGENT=true`), confirm `200`.

1. [README] `cd web && cp .env.example .env.local` — succeeded.
2. [README] Read `.env.local` to confirm `NEXT_PUBLIC_MOCK_AGENT=true` is the default. Confirmed (line 46).
3. [README] `npm install` — already up to date (115 packages, 0 vulnerabilities).
4. [README] Per port-conflicts section, attempted `npx next dev --port 3001`. **Skipped** — the test brief says 3001 is also taken, and `lsof` confirmed it. The README only gives an example for "port 3000 is taken" with `--port 3001`; it does not explicitly say "pick any free port."
5. [INFER] Extrapolated the pattern and tried `npx next dev --port 3002`.
6. [ERROR] Next.js 16 reported `Ready in 285ms` then immediately exited with code 1:

   ```
   ⨯ Another next dev server is already running.
   - Local: http://localhost:3001
   - PID:   39209
   - Dir:   /Users/jordantran/.../web
   - Log:   .next/dev/logs/next-development.log
   Run kill 39209 to stop it.
   ```

   `curl http://localhost:3002` → `000` (not bound). The existing dev server PID 39209 holds an exclusive lock at `web/.next/dev/lock`, so **no `--port` value will let a second `next dev` start from this same directory**. The README does not mention this lock at all. Per the test rules I cannot kill PID 39209.

7. [INFER] Briefly opened `web/node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js` (lines 142–160) to confirm the lock is acquired at `<distDir>/lock` and is gated on `experimental.lockDistDir`. `next dev --help` exposes no `--dist-dir` flag. The only escape hatch without killing the other process is to use a different `distDir`.
8. [INFER] Modified `web/next.config.ts`:

   ```ts
   distDir: process.env.NEXT_DIST_DIR || ".next",
   ```

   then ran `NEXT_DIST_DIR=.next-validate npx next dev --port 3002`. **This is a deviation from the README and is the friction this scenario is mainly about.**
9. [README] Confirmed the dev server reported `Environments: .env.local` (so `NEXT_PUBLIC_MOCK_AGENT=true` is in effect) and `Ready in 178ms`.
10. [README] `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002` → **`200`**. Server log: `GET / 200 in 1355ms (next.js: 1263ms, application-code: 92ms)`.

Final state for Scenario 1: server bound on **3002** with mock agent; `200` returned. Reaching that state required (a) extrapolating beyond the example port and (b) a `next.config.ts` edit the README never mentions.

## Scenario 2 — real agent

Goal: same dev server, but with OpenRouter wired and `NEXT_PUBLIC_MOCK_AGENT=false`. Verify `/api/agent/orchestrate` returns 200 and streams SSE — and crucially does **not** set `x-agent-fallback: local`.

1. [README] Step 1 says: "Get a key from https://openrouter.ai." For this test I was told to treat `/Users/jordantran/Agemo/microbots/agent/.worktrees/jordan-microbot_harness_v0/agent/.env` as "my key." That path is **not** documented anywhere in `web/README.md` — flagging as a docs gap (see Friction below). Pulled the value with `grep '^OPENROUTER_API_KEY=' .../agent/.env`, length 73 (`sk-or-v1-…` shape).
2. [INFER] Stopped the Scenario-1 dev server (`kill_shell` on the background process I started — not on PID 39209/23966, which is the pre-existing one). The README says "Restart `npm run dev`" for step 4 but does not say *how* to stop the previous one. For a normal contributor running `npm run dev` in a foreground terminal that's obviously Ctrl-C; for someone running it backgrounded it's slightly less obvious. Minor.
3. [README] Step 2: edited `web/.env.local` so `OPENROUTER_API_KEY=<the 73-char key>`. Used `sed -i ''` since the README does not prescribe an editor.
4. [README] Step 3: edited `web/.env.local` so `NEXT_PUBLIC_MOCK_AGENT=false`.
5. [README] Step 4: restarted dev server. Same workaround as Scenario 1 step 8: `NEXT_DIST_DIR=.next-validate npx next dev --port 3002`. Re-using the `next.config.ts` modification from Scenario 1.
6. [README] `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002` → **`200`**.
7. [README] Hit the orchestrator:

   ```
   curl -sN -D - -X POST -H 'content-type: application/json' \
     -d '{"query":"hi","snapshot":{"viewport":{"w":1440,"h":900},"windows":[],"focusedId":null,"recentActions":[],"user":{"query":"hi"},"ui":{"mode":"windowed"}}}' \
     http://localhost:3002/api/agent/orchestrate
   ```

   Response headers:

   ```
   HTTP/1.1 200 OK
   content-type: text/event-stream
   x-agent-model: google/gemini-2.5-flash-lite
   ```

   No `x-agent-fallback: local` header → OpenRouter is genuinely loaded and the orchestrator is not falling back to `lib/agent-router.ts`. Body included a real LLM stream:

   ```
   data: {"type":"dock","state":"thinking"}
   data: {"type":"agent.status","status":"google/gemini-2.5-flash-lite · thinking…"}
   data: {"type":"reply.start","query":"hi"}
   data: {"type":"reply.chunk","text":"set"}
   data: {"type":"reply.chunk","text":" your user id in settings first."}
   data: {"type":"agent.tool.start","name":"open_window","args":{"kind":"settings","mount":"full"}}
   data: {"type":"ui.room","room":"settings"}
   data: {"type":"agent.tool.done","name":"open_window","ok":true}
   data: {"type":"reply.done"}
   data: {"type":"dock","state":"idle"}
   ```

Final state for Scenario 2: server bound on **3002** with `NEXT_PUBLIC_MOCK_AGENT=false`, `OPENROUTER_API_KEY` loaded, `/api/agent/orchestrate` returns `200` and emits a real SSE stream from `google/gemini-2.5-flash-lite`. Pure README path was again only blocked by the dev-lock issue.

## Friction points

### 1. Hard blocker: Next.js 16 dev-lock when a sibling dev server already runs in `web/`

- **WHERE**: "## Run" → "### Port conflicts" section.
- **WHAT**: The README treats port collisions as the only failure mode and says "Nothing in the app config hard-codes 3000 — the dev server's port is the only thing that cares." On Next.js 16 that is no longer true. Next now writes a singleton lockfile at `web/.next/dev/lock`; if any process already owns it (very common in this hackathon repo where multiple worktrees share `web/` semantics, or where a teammate already runs `npm run dev` from this same directory), `next dev` will print "Another next dev server is already running" and exit `1` *regardless of the `--port` value*. The README's `--port 3001` workaround does not apply.
- **HOW I resolved it**: read `node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js` to understand the lock. Patched `next.config.ts` to accept a `NEXT_DIST_DIR` env override and ran `NEXT_DIST_DIR=.next-validate npx next dev --port 3002`. Reverted both the config edit and the resulting `.next-validate/` directory at the end (worktree is clean).
- **SUGGESTED fix**: in the "Port conflicts" subsection, add something like:

  > Next 16 also keeps a singleton lock at `.next/dev/lock`. If another `next dev` already owns this directory (e.g. a teammate or another worktree), no `--port` flag will help — either kill the holder (PID is in the error message and in `.next/dev/lock`), or set `NEXT_DIST_DIR=.next-alt` (and add `distDir: process.env.NEXT_DIST_DIR || ".next"` to `next.config.ts`) to give your second instance its own lock.

  Even just naming the failure mode would save 30 minutes of source-spelunking.

### 2. Port-conflicts example is a single hop, not a recipe

- **WHERE**: "### Port conflicts".
- **WHAT**: README says "If port 3000 is taken … pass `--port`: `npx next dev --port 3001`." It does not generalize. A reader has to infer that 3002, 3003, … are equally fine. Trivial inference, but worth one extra sentence given the reader is already in pain.
- **HOW I resolved it**: extrapolated.
- **SUGGESTED fix**: rewrite the example as `npx next dev --port <any free port>` and pick `3002` as the example to nudge readers away from `3001` (which is itself the harness frontend's typical fallback per the README's own paragraph above).

### 3. OpenRouter key acquisition is a one-liner

- **WHERE**: "### Mock vs real agent", numbered step 1.
- **WHAT**: "Get a key from https://openrouter.ai (a few dollars of credit goes a long way at Flash-Lite rates)." For a literal first-time contributor that's three implicit steps (sign up, add credit, generate key). Not a docs disaster — most people understand SaaS dashboards — but the README never says where in the OpenRouter UI to actually create the key, what scope/name to give it, or how to verify the key works *before* dropping it into `.env.local`. There is also no mention of the team's shared key location at `agent/.worktrees/jordan-microbot_harness_v0/agent/.env`; per the test brief I was told that path is intentionally undocumented, so the README is correct not to point at it, but it does mean a teammate who knows that file exists will find this section friction-free while a true newcomer is on their own.
- **HOW I resolved it**: used the path the test brief provided.
- **SUGGESTED fix**: one extra bullet under step 1: "After signing in, hit https://openrouter.ai/keys, create a key, and verify with `curl -H 'Authorization: Bearer $KEY' https://openrouter.ai/api/v1/models | head` before pasting it into `.env.local`." If there *is* a team-shared key location, mention it (or explicitly say "ask in #microbots for the shared dev key").

### 4. `.env.example` → `.env.local` copy doesn't mention what survives a `git status`

- **WHERE**: "## Run" code block.
- **WHAT**: README does not say `.env.local` is gitignored, and does not say to keep secrets out of `.env.example`. Both are obvious to a Next dev. But `.env.example` ships with `NEXT_PUBLIC_MICROBOTS_BASE_URL=https://app-bf31.onrender.com` hard-coded — fine in a public repo, but worth flagging that this is a real prod URL someone may not want their local dev hitting by default.
- **HOW I resolved it**: ignored — outside the test scope.
- **SUGGESTED fix**: optional one-liner — "`.env.local` is gitignored; treat it as your secrets file."

### 5. "Restart `npm run dev`" assumes a foreground terminal model

- **WHERE**: "### Mock vs real agent", numbered step 4.
- **WHAT**: Step says "Restart `npm run dev`." but never names the stop step. Anyone running it in tmux / a subagent / a CI container has to figure out their own kill story. Minor.
- **HOW I resolved it**: killed the background shell I had started.
- **SUGGESTED fix**: "Stop the running dev server (Ctrl-C in the terminal you started it in) and re-run `npm run dev`." Trivial, costs one sentence.

### 6. Verification step is missing

- **WHERE**: end of "## Run" / end of "### Mock vs real agent".
- **WHAT**: README never tells the reader how to confirm the real-vs-mock switch actually took effect. The single best signal — the `x-agent-model` / `x-agent-fallback` response headers on `/api/agent/orchestrate` — is documented nowhere in `web/README.md`. I only knew to look because the test brief told me. A normal contributor will see the UI come up either way and assume they're on the real agent when they may silently be on `agent-router.ts` fallback.
- **HOW I resolved it**: prompt told me what to curl.
- **SUGGESTED fix**: short "## Smoke test" section with the same `curl -X POST … /api/agent/orchestrate` snippet from the test brief, plus: "Look for `x-agent-model: google/gemini-2.5-flash-lite` in the response headers. If you see `x-agent-fallback: local`, your `OPENROUTER_API_KEY` isn't being loaded — check `.env.local` and that you fully restarted the dev server."

## Things the README got right

- "## Run" is short and copy-pastable; three commands and you're moving. No yak-shaving on Node version managers, package manager wars, or `pnpm` vs `npm`.
- `.env.example` was accurate: `NEXT_PUBLIC_MOCK_AGENT=true` really is the default and the mock path really does work end-to-end without a single API key.
- The mock-vs-real explanation is honest about what the orchestrator needs (`OPENROUTER_API_KEY`) and what it doesn't (the FastAPI backend, the STT/TTS keys). It explicitly calls out that graph + integration rooms degrade to "backend offline" without crashing — that prevented me from going down a rabbit hole when I noticed empty rooms during Scenario 1.
- The model is locked to `google/gemini-2.5-flash-lite` with a clear "do not change without an eval-justified reason" guardrail. Good signal for a fresh contributor that this isn't a knob to fiddle with.
- The "Structure" tree was useful when I needed to confirm `lib/agent-router.ts` was the local-fallback path mentioned in the test brief — I didn't have to grep blind.
- Pointing to `lib/agent-client.ts` for the typed event schema saved me having to discover the SSE payload shape from logs.

## Final state of running processes

- **Killed**: the two background dev servers I started in this session (`shell_id 47f210` — Scenario 1 attempt that never bound a port; `shell_id 20c868` — Scenario 1 successful run on 3002; `shell_id e834b7` — Scenario 2 successful run on 3002). All three were started by me and all three are gone. `lsof -nP -iTCP:3002 -sTCP:LISTEN` returns empty.
- **Left running, untouched per instructions**:
  - PID **98055** on port 3000 (a `node` process; not from this worktree per `lsof` — appears to be the unrelated Next.js process the test brief warned about).
  - PID **23966** on port 3001 (a `node` process from `web/.next/dev/lock` in this worktree). **Note**: at the start of the session this slot was held by PID 39209. Some time during my run that PID exited and was replaced by 23966 — most likely because my edits to `.env.local` and `next.config.ts` triggered the existing dev server's config-change full-restart. I did not actively kill 39209; it self-restarted.
- **Worktree state**: clean. `git status web/` reports `nothing to commit, working tree clean`. Specifically:
  - `web/next.config.ts` — reverted to its original 6-line form (no `distDir` override).
  - `web/.env.local` — removed (it never existed in git; matches pre-test state).
  - `web/.next-validate/` — removed.
  - `web/tsconfig.json` — Next 16 auto-injected `.next-validate/types/**/*.ts` and `.next-validate/dev/types/**/*.ts` paths during my run; reverted with `git checkout`.
- **Created (kept)**: this report at `web/tests/parallel-runs-2026-04-26/README-validation/report.md`.
