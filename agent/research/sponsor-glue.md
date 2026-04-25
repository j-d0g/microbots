# Sponsor Glue: Mubit, Render, Anthropic OAuth

Research agent R10 - microbots overnight ralph loop. Compiled 2026-04-24.

## TL;DR

Mubit is a drop-in execution-memory layer (Python, alpha v0.5.1, Apache-2.0) that auto-injects past lessons into every LLM call. It officially supports LangGraph, CrewAI, AutoGen, LangChain, ADK, Vercel AI SDK, MCP, and Agno - **no first-party pydantic-ai package yet**, but the SDK is generic enough to wrap pydantic-ai's `Agent.run`. Render is a viable one-stop host: FastAPI web service + native Cron Jobs + Blueprints (`render.yaml`) + a REST API for programmatic service creation, ideal for the "promoted microservice" pattern. SurrealDB v2 runs on Render via a community Dockerfile, but Surreal Cloud is safer for the demo. **Anthropic OAuth is a dead-end for microbots**: as of 2026-04-04, Anthropic bans third-party agent frameworks from using Claude.ai subscription tokens. Founders must use API keys.

---

## Mubit

**SDK setup.** Install the framework-specific package (e.g., `mubit-langgraph`, `mubit-agno`); they all depend on `mubit-integration-base` v0.5.1 (released 2026-04-23, Python >=3.10, alpha). The init pattern documented on mubit.ai is: one call with an API key + agent ID, after which "all LLM calls now auto-inject lessons and auto-capture outcomes." No model retraining; the SDK monkey-patches the client.

**What's captured / injected.** Mubit stores execution outcomes (successes, errors, edge cases), conversation state, and "operational context, past outcomes." On the next run it retrieves relevant lessons (sub-80ms recall claimed) and prepends them to the system/context window. Effectively: a managed RAG layer scoped to your agent's own history.

**Framework support.** Officially shipped: `mubit-langgraph`, `mubit-crewai`, `mubit-agno`, `mubit-adk`, `mubit-langchain`. In progress: `mubit-llama_index`, `mubit-autogen`, `mubit-agent_lightning`. Also advertised: Vercel AI SDK, MCP. **No `mubit-pydantic-ai` package** as of 2026-04-23. Two options for microbots: (a) wrap pydantic-ai's underlying Anthropic/OpenAI client by initializing Mubit before constructing the `Agent`, since Mubit hooks at the LLM-client layer; (b) drive the Agno integration if you can swap pydantic-ai for Agno on the demo path. Worth a 30-min spike to confirm option (a) works.

**Cost.** Marketing copy is "Flat, predictable. No GPU costs or per-token billing" - no public price sheet. Reach out to Mubit DevRel at the hackathon for a sponsor credit.

**Privacy / data residency.** Not documented publicly. Treat as cloud-hosted; assume traces leave the founder's environment. For the demo, scope Mubit to a single test agent ID and avoid sending PII. Flag this as an open question if the audience asks.

**Demo angle - "improved overnight."** Run two agent invocations side by side:
1. Run 1 (8pm): agent fails a multi-step workflow (Composio + SurrealDB write); Mubit captures the failure trace.
2. Overnight ralph loop: a Render Cron Job replays a representative test set against the same agent with Mubit on, surfacing extra lessons.
3. Run 2 (9am): same prompt, agent now succeeds. Show the Mubit dashboard's "lessons" panel side-by-side with a diff of the system prompt that was auto-injected.

**For microbots v0:** ship `mubit-langchain` or `mubit-agno` wrapping our pydantic-ai layer; gate behind a `MUBIT_ENABLED` env var. Keep the lessons store scoped per-tenant via agent ID = founder ID. Defer pydantic-ai-native integration - file a GitHub issue with Mubit during the hackathon.

---

## Render

**FastAPI deploy.** Web Service, Language `Python 3`, build `pip install -r requirements.txt`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`. No Procfile needed; Render injects `$PORT`. Auto-deploy on `git push` to the tracked branch (configurable per service).

**Cron Jobs.** Native primitive. Standard cron syntax in UTC (e.g., `0 12 * * *`). 12-hour max per run, single-instance guarantee (overlapping triggers cancel the older run). Cron Jobs **cannot mount persistent disks**, so the heartbeat consolidator must read/write through SurrealDB or object storage. Billed per-second of runtime, $1/month minimum per service.

**Blueprints (`render.yaml`).** Root sections: `services`, `databases`, `envVarGroups`, `projects`. Service types: `web`, `pserv` (private), `worker`, `cron`, `keyvalue`. Env vars support direct values, `fromService`/`fromDatabase` cross-references, and `sync: false` for secret prompts during initial Blueprint creation. Validate via Render CLI or SchemaStore IDE plugin. This is the right shape for microbots: one repo, multiple services (api, cron-consolidator, worker, surreal).

**Secrets.** Inject via `envVarGroups` (reusable across services) or per-service `envVars` with `sync: false` for `ANTHROPIC_API_KEY`, `COMPOSIO_API_KEY`, `SURREAL_PASS`, `MUBIT_API_KEY`, `LOGFIRE_TOKEN`. Render encrypts at rest; values are exposed only to the service.

**SurrealDB on Render.** SurrealDB v2 is not a first-class managed offering. Two routes: (a) `Olyno/surrealdb-docker` - community Dockerfile with a "Deploy to Render" button using `surrealdb/surrealdb:v2`, env vars `USERNAME`/`PASSWORD`, port 8000, run as a Private Service with a Render Disk for `/data`. (b) Surreal Cloud - simpler, no infra, but external dependency. **Recommendation for hackathon: Surreal Cloud** unless the demo requires SurrealDB to live alongside the API on Render's network.

**Free vs Starter.** Free Web Services spin down after 15 min idle, cold-start in 30-60s, capped at 750 hours/month. That's a demo-killer. Use Starter ($7/mo) for the api service and free tier for cron + worker. Free Cron Jobs availability is unclear - assume paid.

**Programmatic deploy ("promoted microservice").** Render API is REST + OpenAPI 3.0 spec. Endpoints cover services, deploys, env groups, blueprints, custom domains, one-off jobs. Authentication is a single API key (account-scoped, shown once). Microbots-the-agent can: POST `/services` to create a new web service from a Git repo + branch, POST a deploy, then watch via `/deploys/{id}`. This is the linchpin of the "agent scaffolds a workflow and promotes it to production" narrative.

**For microbots v0:** single repo, `render.yaml` with `api` (Starter web), `cron-consolidator` (Cron Job, hourly), `surreal` (Private Service on Disk *or* skip in favor of Surreal Cloud), shared `envVarGroup: microbots-secrets`. Wire a thin Python wrapper around the Render API for the promotion flow.

---

## Anthropic OAuth

**Hard reality first.** As of **2026-04-04**, Anthropic explicitly banned third-party agent frameworks (Agent SDK, OpenClaw, NanoClaw, etc.) from using Claude.ai Pro/Max OAuth subscription tokens. Boris Cherny (Head of Claude Code): subscriptions "were never designed for the kind of continuous, automated demand these tools generate." Affected users got a one-time credit equal to one month of their plan. **Microbots cannot ship "log in with Claude.ai, pay via your subscription" as designed** without violating Anthropic's policy.

**OAuth flow that does exist** (for Claude Code / Claude.ai / first-party use):
- Authorize: `https://claude.ai/oauth/authorize` (Authorization Code + PKCE, SHA256 challenge)
- Token: `https://console.anthropic.com/v1/oauth/token`
- Default client ID (Claude Code): `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- Redirect URI: `https://console.anthropic.com/oauth/code/callback`
- Scopes: `org:create_api_key`, `user:profile`, `user:inference`
- Token format: `sk-ant-oat01-...`; refresh tokens issued; long-lived variant via `expires_in: 31536000` may omit refresh.
- Copy/paste mode supported via `code=true` query param (for CLIs without a local server).

**Endpoint coverage.** OAuth tokens are accepted by Messages, streaming, files, and extended thinking on the same `/v1/messages` surface as API keys. Batches and the org-admin endpoints behave differently and may require `org:create_api_key` or an actual API key. Treat any non-Messages endpoint as "verify before relying on it."

**Rate limits.** When OAuth was sanctioned, limits tracked the user's Claude.ai tier (Pro/Max/Team). Post-ban, this is moot for third parties.

**pydantic-ai support.** pydantic-ai's `AnthropicProvider` accepts an `api_key` (or `auth_token`) - you can technically pass an OAuth `sk-ant-oat01-...` access token, but doing so for third-party microbots users now violates Anthropic's terms.

**Multi-tenant alternative.** Have founders paste their **own API key** (`sk-ant-api03-...`) at onboarding. Store encrypted per-tenant in SurrealDB; rotate on demand. This is the OpenClaw-recommended production path: "Anthropic API keys are still the clearest and most predictable production path."

**Demo angle.** Skip the visual OAuth flow. Instead show: founder pastes API key in <10 seconds, microbots validates with a `/v1/models` ping, then runs. Frame as "BYO key, your spend, your data" - which actually plays better with founders concerned about lock-in.

**For microbots v0:** ditch OAuth. Build a per-tenant API-key onboarding step (encrypted at rest, never logged). Add a one-line note in the readme acknowledging the 2026-04-04 policy. If Anthropic carves out a "managed agent" exception later, revisit.

---

## Sources

- Mubit: https://mubit.ai/, https://pypi.org/project/mubit-integration-base/ (v0.5.1, 2026-04-23)
- Render: https://render.com/docs/deploy-fastapi, https://render.com/docs/cronjobs, https://render.com/docs/blueprint-spec, https://render.com/docs/api, https://github.com/Olyno/surrealdb-docker
- Anthropic OAuth: https://gist.github.com/ben-vargas/c7c7cbfebbb47278f45feca9cef309d1, https://docs.openclaw.ai/providers/anthropic, https://www.pymnts.com/artificial-intelligence-2/2026/third-party-agents-lose-access-as-anthropic-tightens-claude-usage-rules/ (2026-04-04 policy)
