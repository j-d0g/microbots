# Composio for microbots

Research agent: R8 | Date: 2026-04-24 | Sources: docs.composio.dev (toolkit pages versioned `20260417_00`), composio.dev/toolkits.

## TL;DR

Composio is a hosted auth + tool-execution layer for AI agents. Founders connect SaaS apps (Slack/Gmail/Linear/Notion/GitHub) via Composio's hosted OAuth — Composio stores and refreshes tokens server-side, keyed by your `user_id`. Two integration shapes: (1) **MCP** — point pydantic-ai at a Composio-issued MCP URL, near-zero config; (2) **Direct SDK** — call `composio.tools.execute(slug, args, user_id=...)`. For microbots v0, MCP + pydantic-ai's `MCPServerStreamableHTTP` is the fastest path. Free tier covers 20k tool calls/mo. Composio also ships a browser-tool, but for a hackathon, pair it with `browser-use` for fallback.

## Auth + Multi-User (the important bit)

**Token storage = Composio's side, not ours.** Composio is the OAuth client of record; we never touch raw tokens. Three identifiers to keep straight:

- `auth_config_id` — blueprint per toolkit (scopes, OAuth client creds). Created once in the Composio dashboard (or programmatically). Reused across all users.
- `user_id` — *our* identifier (e.g. `microbots:user_42`). We pass it on every call; Composio uses it as the tenant key.
- `connected_account_id` (`ca_…`) — Composio's record of one user's connection to one toolkit. A user can have many (e.g. work + personal Gmail).

**OAuth flow — what we implement:**

```python
from composio import Composio
composio = Composio(api_key=COMPOSIO_API_KEY)

# 1. Kick off a connection from our backend
req = composio.connected_accounts.initiate(
    user_id="microbots:user_42",
    auth_config_id=AUTH_CONFIG_GMAIL,
    config={"auth_scheme": "OAUTH2"},
    callback_url="https://microbots.app/oauth/callback",
)
# 2. Redirect the user's browser to req.redirect_url
#    (Composio hosts the consent screen + handles the provider callback)
# 3. Composio redirects back to our callback_url with:
#    ?status=success&connected_account_id=ca_abc123&user_id=microbots:user_42
# 4. Optionally block until ACTIVE:
account = req.wait_for_connection()
```

**What we DON'T implement:** the OAuth client app on Slack/Google/etc. (Composio brings its own by default; we can swap in our own creds via auth config if we want our own brand on the consent screen). No callback URL on the *provider* side either — Composio's URL is registered, and Composio re-redirects to ours.

**Token refresh:** automatic. Connection states: `INITIATED → ACTIVE → EXPIRED`. If refresh fails (user revoked), we surface a "reconnect" prompt.

**Multi-tenant model:** one auth_config fans out to N connected_accounts. Per-call isolation is by `user_id` — every `tools.execute` and every MCP session is bound to a single user.

## Tool Surface Highlights (counts from toolkit docs, Apr 2026)

| Toolkit | Tools | Auth | Examples |
|---|---|---|---|
| Slack | 151 (+ 5 triggers) | OAuth2 (user or bot) | `SLACK_SEND_MESSAGE`, `SLACK_LIST_CHANNELS`, `SLACK_SEARCH_MESSAGES` |
| Gmail | 62 | OAuth2 | `GMAIL_SEND_EMAIL`, `GMAIL_FETCH_EMAILS`, `GMAIL_CREATE_EMAIL_DRAFT` |
| Linear | 33 | OAuth2 / API key | `LINEAR_CREATE_ISSUE`, `LINEAR_LIST_ISSUES`, `LINEAR_CREATE_COMMENT` |
| Notion | ~50 | OAuth2 | `NOTION_QUERY_DATABASE`, `NOTION_CREATE_PAGE`, `NOTION_APPEND_BLOCK_CHILDREN` |
| GitHub | ~100 | OAuth2 / PAT | `GITHUB_CREATE_ISSUE`, `GITHUB_CREATE_PR`, `GITHUB_LIST_COMMITS` |

Triggers exist for some apps (Slack: 5) — webhook-style "new message" subscriptions. For microbots v0 we likely poll, not subscribe.

## pydantic-ai Integration Shape

Composio publishes a first-party pydantic-ai integration. **It's MCP-based, not a custom toolset class** — you get a hosted MCP URL per session and pydantic-ai's `MCPServerStreamableHTTP` consumes it natively.

```python
from composio import Composio
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStreamableHTTP

composio = Composio(api_key=COMPOSIO_API_KEY)
session = composio.create(
    user_id="microbots:user_42",
    toolkits=["gmail", "slack", "linear"],   # scope tools per request
)

mcp_server = MCPServerStreamableHTTP(
    session.mcp.url,
    headers={"x-api-key": COMPOSIO_API_KEY},
)
agent = Agent("openai:gpt-4o", toolsets=[mcp_server],
              instructions="You are microbot Mira, a Linear PM…")

async with agent.run_stream(user_input, message_history=history) as stream:
    async for chunk in stream.stream_output():
        ...
```

**Cost: roughly zero-config.** Tools auto-register, schemas come from Composio, the agent's tool registry is just `[mcp_server]`. Per-user scoping happens because we mint a session per `user_id`.

**Alternative (Direct SDK)** — if we want fine-grained Python tool wrappers (so each microbot exposes a curated subset, validates with pydantic models, or injects SurrealDB context), wrap `composio.tools.execute(slug, args, user_id=...)` inside pydantic-ai `Tool` objects. More code, but more control over which tools each bot sees and ability to mix Composio actions with native Python tools (e.g. SurrealDB queries) in one flat tool list.

For microbots' "agent loop calls Composio tools as part of its tool registry" — both approaches satisfy that. **Recommendation: start MCP, drop to direct SDK only if we hit limits** (e.g. need to inject our own metadata into tool responses before the LLM sees them).

## Browser-Agent Question

Composio ships a **Browser Tool toolkit** + an open-source Chrome extension that does Gemini-computer-use-style visual automation. So in principle, Composio covers the fallback. However:

- The browser tool is a *separate toolkit* — not the same execution path as direct API calls. Latency is much higher.
- Hackathon-realistic: pair Composio (for the 80% with first-class APIs) with `browser-use` (Python lib, integrates cleanly with pydantic-ai) or **Anthropic Computer Use** for true long-tail. `browserbase` adds hosted infra if we need that.
- **Recommendation:** Composio for primary tool calls; `browser-use` as the explicit fallback agent invoked when "no Composio tool fits." Don't conflate them in one tool registry — keep them as two distinct execution modes the orchestrator routes between.

## Rate Limits + Cost

- **Free:** 20k tool calls/mo. Plenty for a demo.
- **$29/mo (Hobby):** 200k calls, then $0.299/1k.
- **$229/mo (Pro):** 2M calls, $0.249/1k.
- Premium tools (search, etc.) cost ~3x a normal call.
- SOC2 Type 2; tokens encrypted at rest + transit.

No hard published per-user rate limit beyond plan totals — but each underlying provider (Gmail's 250 quota units/sec, Slack's tier-based limits) still applies and surfaces as a tool error.

## Gotchas

1. **Cold-start latency:** MCP session creation = one round trip; tool execution adds Composio hop + provider hop. Expect 300–800ms p50 for simple actions, multi-second for searches.
2. **Partial success:** Composio returns `{successful: bool, data, error}`. Don't trust HTTP 200 alone — check `successful`.
3. **Auth-expired mid-loop:** if a token can't refresh, the call returns `AUTHENTICATION_FAILED`. The agent loop must catch this and surface a re-auth nudge to the founder, not silently retry.
4. **Tool sprawl on context:** if you load all of Slack's 151 tools into one MCP session, that's a lot of schema. Use the `toolkits=[…]` scoping AND consider Composio's Tool Router (lazy tool discovery) for production. For a hackathon demo it's fine.
5. **Triggers vs polling:** Composio triggers are webhooks pointed at *your* server. For a hackathon backend behind ngrok/localtunnel, polling is simpler.
6. **OAuth callback URL must be HTTPS** in production (localhost:port works in dev, but for a deployed demo set up a stable HTTPS callback before founder onboarding).

## Recommendation: microbots v0 Demo Path

**Three integrations:** Gmail + Slack + Linear (covers inbound signal, conversation, action).

**Setup steps (founder onboarding):**

1. **One-time, by us:** in Composio dashboard, create three Auth Configs (`gmail`, `slack`, `linear`) using Composio's default OAuth apps. Store the three `auth_config_id`s in env/SurrealDB.
2. **Per founder, in app:**
   - Founder hits `Connect Gmail` → backend calls `connected_accounts.initiate(user_id, AUTH_CONFIG_GMAIL, callback_url=…)` → redirect.
   - Composio handles consent + callback. Backend's `/oauth/callback` route stores `connected_account_id` against the user in SurrealDB (mostly for UI; Composio is source of truth).
   - Repeat for Slack + Linear.
3. **At agent runtime:**
   - `session = composio.create(user_id=founder.id, toolkits=["gmail","slack","linear"])`
   - Pass `session.mcp.url` to a pydantic-ai `MCPServerStreamableHTTP`.
   - Run the agent loop. SurrealDB stores conversation/memory; Composio stores tokens.
4. **Fallback:** when the LLM emits a tool call that doesn't match any Composio tool (or a Composio tool errors with "not implemented for this account type"), route to a `browser-use` agent in a separate node of the graph.

**Why this composition wins for the demo:** founders get a one-click connect flow per app, we write zero OAuth/token-refresh code, the agent loop stays a clean pydantic-ai shape, and we can demo "agent reads Slack thread → drafts Linear issue → emails update via Gmail" with three real toolkits, all per-user-isolated, in a single session.

## Sources

- https://docs.composio.dev/auth/introduction
- https://docs.composio.dev/docs/authenticating-tools
- https://docs.composio.dev/docs/auth-configuration/connected-accounts
- https://composio.dev/toolkits/composio/framework/pydantic-ai
- https://docs.composio.dev/toolkits/gmail
- https://docs.composio.dev/toolkits/slack
- https://docs.composio.dev/toolkits/linear
- https://composio.dev/ (pricing)
