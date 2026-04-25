# Agemo Runtime → microbots Translation

## TL;DR

Agemo treats every workflow as a self-contained PEP-723 Python script that boots a FastAPI app on a port. A central coordinator (`containers/runtime/service.py`) provisions an E2B sandbox per request, injects `process_request.py`, which `uv run`s `server.py`, streams logs, and posts the result back. Schedules are an EventBridge → Lambda → `/run_async` HTTP poke. For microbots v0, the simplest port is: **one Render Web Service for agent+UI, one Render Web Service per promoted microbot (Devin scaffolds, Render auto-deploys from git), Render Cron Jobs for scheduling, no E2B**. E2B is over-engineered for a hackathon.

---

## Agemo workflow architecture as I understand it

### 1. Workflow as artifact: a single `server.py`

Each workflow under `runtime/workflows/<name>/` is one Python file (`<name>.py`) following a strict contract:

- **PEP 723 inline metadata** at top: `requires-python`, `dependencies`, and a `[tool.env-checker]` block declaring required env vars (`CODEWORDS_API_KEY`, `CODEWORDS_RUNTIME_URI`, `PORT=8000`, etc.).
- A FastAPI `app = FastAPI(...)` with **typed Pydantic request/response models**.
- Standard middleware boilerplate: `RequestIdMiddleware` (binds `request_id` / `correlation_id` / `caller_id` to structlog contextvars), `ExceptionMiddleware` (returns OpenAI-style error envelope).
- A single `@app.post("/")` (or a few sub-paths) that contains the actual workflow logic.
- Calls to other workflows / library services go through `CODEWORDS_RUNTIME_URI` (the coordinator), not direct imports — every cross-service call is HTTP.

Pattern name: **"FastAPI sidecar per task"**. The workflow doesn't know about Lambda, sandboxes, or schedulers — it's just an HTTP server that gets spun up.

### 2. The coordinator (`containers/runtime/service.py`)

Single FastAPI gateway (~6.7k lines). Key endpoints relevant to microbots:

| Endpoint | Purpose |
|---|---|
| `POST /run/{service_id}/{path}` | Sync execute |
| `POST /run_async/{service_id}/{path}` | Async execute (returns request_id immediately) |
| `POST /provision-request` | Reserve a request_id before exec |
| `GET /logs/{request_id}` | NDJSON log stream |
| `GET /result/{request_id}` | Long-poll for completion |
| `POST /webhook/{service_id}/...` | External provider webhooks (Slack, WhatsApp) → forward async |

The coordinator is **the only service that talks to E2B**. It also owns auth (via `agemo_auth` forward-auth), Stripe billing, S3 file uploads, and per-service env override resolution (`SecretOverride` → `Secret` → schema default).

### 3. E2B sandbox lifecycle (per-request cold start)

For each `/run_async` call, the coordinator:
1. Creates a fresh E2B sandbox from a pre-built template (`E2B_TEMPLATE_ID=agemo-uv-ffmpeg-...`). Template bakes in ffmpeg, Python 3.10/3.11/3.12 via `uv`, a warmed `uv` cache, and `/opt/process_request.py`.
2. Uploads the workflow code (pulled from S3 bucket `codewords-services`) to the sandbox.
3. Runs `process_request.py` with env vars: `CODEWORDS_API_KEY`, `CODEWORDS_RUNTIME_URI`, `SERVICE_ID`, `REQUEST_ID`, `PORT`, `REST_OF_PATH`, `REQUEST_HEADERS_JSON`, `REQUEST_BODY_PATH`.
4. `process_request.py` does five things: `uv run server.py` → wait for `/health` → forward the real HTTP request → `POST /logs` every 0.5s with stdout/stderr buffer → `POST /request` with the final response → exit.
5. Sandbox dies. **No pooling** — every request pays sandbox cold-start. There is a `<SERVICE_ID>_SERVICE_URL` escape hatch ("always-on" services like `WHATSAPP_TRIGGER_SERVICE_URL`) that bypasses E2B and points at a stable URL — that's how stateful triggers run.

Pattern name: **"per-request ephemeral sandbox + always-on URL override for trigger services"**. The override mechanism is the closest analogue to what microbots actually wants.

### 4. Library services — shared modules via HTTP, not imports

`runtime/library_services/` (web_agent, linkedin_intelligence, e2b_sandbox, send_email, transcribe, replicate, etc.) look like helpers but are **deployed as their own workflows** — each has the same `server.py` shape. Workflows consume them by HTTP-calling `{CODEWORDS_RUNTIME_URI}/run/<library_service_id>/...`, often through an OpenAI-compatible shim (e.g. Gemini exposed as an OpenAI base_url). There is no "import-time loading into the sandbox" — everything is service-to-service over HTTP. This is what makes the architecture flat and language-agnostic.

### 5. Schedule runner — EventBridge + Lambda + DB row

`runtime/schedule_runner/` is dead simple:
- A `ScheduledRequest` row in Postgres (Prisma): `serviceId`, `path`, `method`, `bodyJson`, `userId`, `active`.
- An EventBridge schedule (created via `boto3 scheduler.create_schedule`, `rate(1 minute)` / cron expression) that fires a Lambda with `{"schedule_id": "..."}` payload.
- The Lambda (`lambda_function.py`) looks up the row, mints a user API key, builds `{RUNTIME_URI}/run_async/{serviceId}/{path}`, and POSTs it. 30s timeout — fire and forget. Returns 200 even on workflow timeout (the `/run_async` returns a request_id immediately anyway).

Pattern name: **"the scheduler is just an authenticated HTTP poker"**. Trivially portable.

### 6. Client SDK (`codewords-client`)

`pip install codewords-client`. The SDK (`codewords_client.py`) wraps the coordinator: `provision_request()`, `run_service(service_id, inputs, in_background=True)`, `start_service()`, `AsyncCodewordsResponse.logs()` / `.result(timeout)` / `.details()`. Auto-injects `X-Correlation-Id` from structlog contextvars. Inside a workflow, `run_service` is how you call other workflows — the SDK is a thin httpx client over the public coordinator endpoints. There's also a `redis_coordinator` module for cross-step coordination (Redis pub/sub for fan-out / wait-for-event patterns), but most workflows don't need it.

### 7. CDM2 — internal admin UI

FastAPI:8888 + React:5173 for ops to view services from the last 48h, deploy/duplicate, switch prod ↔ staging DBs. **Skip for microbots.** The microbots iframe-in-chat UX is for founders; admin tooling can be replaced with a single "list my microbots" page later.

---

## Translation to Render-native

| Agemo primitive | Render equivalent | Notes |
|---|---|---|
| Workflow (`server.py`) | Render Web Service (Python) | Each promoted microbot = one Render service. Render auto-deploys from a git push. |
| Coordinator (`/run`, `/run_async`) | A single Render Web Service ("dispatcher") | Microbots probably doesn't need it for v0 — see below. |
| E2B sandbox (per-request) | **Drop entirely** for promoted bots. Optionally keep E2B for the *unpromoted* exploratory step (where the founder is testing automations before accepting). | E2B's value is untrusted-code isolation. Once the founder approves and Devin scaffolds, the code is trusted. |
| Schedule runner Lambda | Render Cron Job | Render Cron is a first-class primitive that hits a URL or runs a command. Way simpler than EventBridge + Lambda + Prisma row. |
| `ScheduledRequest` DB row | Render Cron Job (one per scheduled bot), or one consolidator cron + DB rows | If Render Cron Jobs are cheap, prefer one cron per bot — fewer moving parts. |
| `library_services/` (HTTP-callable shared services) | Either deploy a shared "library" Render service, or use Composio/Pipedream for integrations | Composio is the BRAINDUMP-mentioned integration provider; lean on it instead of rebuilding `linkedin_intelligence.py`. |
| S3 (`codewords-services` for code, `codewords-uploads` for files) | Git (for code, since Render builds from git) + Render Disk or S3 for files | Code-in-S3 was needed because E2B sandboxes needed to download it; once we deploy from git, this disappears. |
| AWS Secrets Manager + per-service env overrides | Render env vars (per service) + per-user secrets in Postgres | Founder-scoped secrets need a real store; service-level secrets just go in Render's env panel. |
| `process_request.py` (sandbox boot script) | **Doesn't exist in Render world.** | Render runs your service directly — no injection layer needed. |

---

## Recommendation for microbots v0

**Single principle: one Render Web Service per promoted microbot, deployed from git, with Render Cron Jobs for scheduled triggers.**

Concrete shape:

1. **`agent-app`** — Render Web Service. The chat UI + LLM agent. Hosts the iframe surface. When the founder accepts a suggested automation, this service:
   - Calls Devin/Cognition with a scaffolding prompt (workflow spec → a `server.py` + `Dockerfile` or `render.yaml`).
   - Pushes the scaffolded code to a sub-repo or monorepo path (`microbots/<bot_slug>/`).
   - Calls Render API to create a new Web Service or Cron Job pointed at that path.
   - Stores `(bot_id, render_service_id, schedule, owner)` in Postgres.

2. **`microbot-<slug>`** — One Render Web Service or Cron Job per promoted bot. FastAPI on `/`, just like Agemo's `server.py` contract (steal it verbatim — PEP 723 metadata + Pydantic models + structlog middleware). Render auto-deploys on git push. For scheduled bots, use Render Cron Job with an HTTP trigger to keep all bots invokable both manually and on schedule.

3. **`heartbeat-consolidator`** — Render Cron Job (the BRAINDUMP-mentioned "every minute decides what to do" loop). Hits a `/heartbeat` endpoint on `agent-app` which checks DB for due tasks across all founders and dispatches.

4. **E2B**: keep ONLY for the unpromoted exploratory phase. When the agent is testing a candidate automation in conversation (before promotion), run it in E2B. Once promoted, code goes to git → Render → trusted execution. This matches Agemo's "always-on URL override" pattern (`<SERVICE_ID>_SERVICE_URL`) but inverts the default: trusted-deployed is the norm, sandbox is the exception.

**What to copy verbatim from Agemo:**
- The `server.py` contract (PEP 723 + FastAPI + structlog `RequestIdMiddleware` + Pydantic models). Devin can be prompted to follow this exact shape.
- The `X-Correlation-Id` / `X-Request-Id` propagation pattern (cheap and pays off in debugging).
- The "every cross-service call is HTTP" architectural rule — keeps services decoupled and trivially deployable separately on Render.

**What NOT to copy:**
- The 6.7k-line coordinator. Microbots calls Render-hosted services directly; no central HTTP router needed for v0.
- AWS SAM templates, EventBridge wiring, the schedule_runner Lambda, S3-as-code-store, CDM2 admin UI.
- The per-request E2B cold start for production bots — pay the Render cold-start once, then warm.

Bot count for the demo: 1–3 promoted microbots is plenty. Keep it boring.
