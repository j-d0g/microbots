# Observability — Centralized Logging with Logfire

One thin facade in `microbots/log.py`, backed by
**[Pydantic Logfire](https://logfire.pydantic.dev)**. Every script and
service uses the same entry points, produces the same records, and tags
every record with a per-run `correlation_id` so a single invocation is
trivial to isolate in the UI.

> Source: <ref_file file="microbots/log.py" />
> Public API: <ref_file file="microbots/__init__.py" />
> Sample env: <ref_file file=".env.example" />

---

## 1. The entire configuration surface

Four environment variables. That's it.

| Variable              | Required | Default                                  | Purpose |
| --------------------- | -------- | ---------------------------------------- | ------- |
| `LOGFIRE_TOKEN`       | no       | *(unset)*                                | Write token. Empty → console-only. Set → **same records** also shipped to Logfire. |
| `LOGFIRE_SERVICE_NAME`| no       | `microbots`                              | Service name in the Logfire UI. |
| `LOGFIRE_BASE_URL`    | no       | auto-detected from token (EU fallback)   | Override the region auto-routing. |
| `LOGFIRE_ENVIRONMENT` | no       | `dev`                                    | `dev` / `staging` / `prod`. |

### Region auto-routing

Logfire write tokens are region-bound. The setup picks the right backend
from the token prefix automatically:

| Token prefix     | Routes to                            |
| ---------------- | ------------------------------------ |
| `pylf_v1_eu_…`   | `https://logfire-eu.pydantic.dev`    |
| `pylf_v1_us_…`   | `https://logfire-us.pydantic.dev`    |
| anything else    | falls back to EU                     |

Only set `LOGFIRE_BASE_URL` if you genuinely need to override it (e.g.
a self-hosted proxy). If your `LOGFIRE_BASE_URL` and token region
disagree, the setup prints an explicit warning at startup so you don't
have to chase a 401 from the export pipeline minutes later.

Optional:

| Variable          | Purpose |
| ----------------- | ------- |
| `CORRELATION_ID`  | Force a specific correlation id for this process. If unset, a fresh 12-char id is generated on startup. Use this to link multiple processes into one logical run. |

No console toggles, no log-level knobs, no opt-in instrumentation flags —
local console output and Logfire output are always the **same records**
with the same timestamps, the same attributes, and the same
correlation_id.

---

## 2. One-time setup

```bash
make install                # uv sync — pulls in logfire>=2.0.0
cp .env.example .env        # fill in LOGFIRE_TOKEN if you want remote shipping
```

No explicit `init` is required. The first use of any helper configures
Logfire from env automatically and idempotently.

---

## 3. Public API

```python
from microbots import (
    get_logger,          # tagged logger
    span,                # context manager
    instrument,          # decorator
    get_correlation_id,  # this run's id
    setup_logging,       # idempotent manual init (rarely needed)
)
```

| Symbol                 | Purpose |
| ---------------------- | ------- |
| `get_logger(name)`     | Returns a Logfire logger tagged with `name`. Has `.info`, `.debug`, `.notice`, `.warn`, `.error`, `.exception`, `.fatal`. Use `__name__`. |
| `span(name, **attrs)`  | `with`-block timing + attributes for a unit of work. |
| `instrument(...)`      | Decorator that turns a function call into a span. |
| `get_correlation_id()` | Stable, 12-char id for this process run. Attached to every record automatically as a resource attribute — this method just returns the value so you can print it, attach it to external API requests, or save it in a database row. |
| `setup_logging()`      | Manual idempotent init — only needed for custom CLIs / test fixtures. |

---

## 4. What gets attached to every record

Regardless of which helper you call, every record that leaves the
process carries:

- `service.name`        — from `LOGFIRE_SERVICE_NAME`
- `deployment.environment` — from `LOGFIRE_ENVIRONMENT`
- `correlation_id`      — this run's unique id (resource attribute)
- Timestamps            — always on, UTC
- Exception info        — when the record was emitted via `log.exception()`

On top of that, anything you pass as kwargs becomes queryable
attributes.

---

## 5. Use-cases

Every example assumes:

```python
from microbots import get_logger, span, instrument

log = get_logger(__name__)
```

### 5.1 Plain log

```python
log.info("user signed in")
```

### 5.2 Structured attributes

```python
log.info(
    "user signed in",
    user_id=user.id,
    plan=user.plan,
    ip=request.client.host,
)
```

### 5.3 Templated messages

Placeholders are interpolated into the message **and** recorded as
queryable attributes:

```python
log.info(
    "deploying {branch} to {env}",
    branch="main",
    env="staging",
)
# → message: "deploying main to staging"   (branch, env queryable)
```

### 5.4 Every severity level

```python
log.debug("cache miss", key="user:42")
log.info("request handled", status=200)
log.notice("rate limit close to threshold", remaining=5)
log.warn("retrying after failure", attempt=2)
log.error("payment refused", code="card_declined")
log.fatal("database unreachable, giving up", host="db-1")
```

### 5.5 Exceptions — with full traceback

```python
try:
    parse(payload)
except Exception:
    log.exception("payload failed validation", payload_id=payload.id)
    raise
```

### 5.6 Spans — measure a unit of work

```python
with span("db.query", table="entity", op="select"):
    rows = await db.query("SELECT * FROM entity WHERE tags CONTAINS 'ai';")
```

Add attributes to the *current* span as you discover them:

```python
with span("ingest.chat", source="slack") as s:
    chat = scrape()
    s.set_attribute("chat_id", chat.id)
    s.set_attribute("token_count", chat.tokens)
```

### 5.7 Decorator form

```python
@instrument("ingest.chat")
def ingest_chat(payload): ...
```

### 5.8 Async — same API

```python
@instrument("workflow.deploy_pipeline")
async def deploy_pipeline(branch: str) -> str:
    with span("deploy.build"):
        await build(branch)
    with span("deploy.push"):
        await push()
    return await live_url()
```

### 5.9 Correlation id in use

```python
from microbots import get_correlation_id

cid = get_correlation_id()
log.info("starting run", job="seed")          # cid attached automatically

# propagate to child processes / external jobs:
subprocess.run(
    ["python", "worker.py"],
    env={**os.environ, "CORRELATION_ID": cid},
)

# include in outbound HTTP requests to stitch traces across services:
requests.post(url, headers={"X-Correlation-Id": cid}, json=payload)
```

Every record from this process already has `correlation_id=<cid>` as a
resource attribute, so in the Logfire UI:

```
correlation_id = "8c3f1a..."
```

surfaces the entire run in one query.

### 5.10 Local-only mode

Leave `LOGFIRE_TOKEN` empty. You still get the same structured console
output with timestamps and correlation_id — nothing is shipped anywhere.

---

## 6. Querying records

### 6.1 In the Logfire UI — <https://logfire-eu.pydantic.dev>

```
service_name = "microbots"
environment = "prod"
correlation_id = "8c3f1a..."       # single-run timeline
tags has "microbots.seed.seed"     # scope to one module
level >= "warn"
name starts_with "schema.apply"
duration > 5s
```

### 6.2 Via the Logfire MCP (for AI tools)

The Logfire EU MCP server is pre-registered in
<ref_file file=".devin/config.local.json" />:

```
https://logfire-eu.pydantic.dev/mcp
```

To use it from inside Devin:

1. Logfire UI → **Settings → Read tokens** → create a read token.
2. Export it: `LOGFIRE_READ_TOKEN=lrt_…`
3. Reload. The MCP exposes tools for querying records, spans, and
   metrics by attribute, tag, or time window.

The MCP is only for AI tooling to read logs back out — it's not part of
the application's runtime path.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| ------- | ---------- |
| Records in console but not in Logfire UI. | `LOGFIRE_TOKEN` is empty (banner shows `ship_to_logfire=False`). |
| `401 Unauthorized` / `Invalid token` from Logfire. | Token region doesn't match the configured base URL. The startup banner shows `base_url=…` — verify it matches the token prefix (`pylf_v1_eu_*` → EU, `pylf_v1_us_*` → US). Easiest fix: remove `LOGFIRE_BASE_URL` from `.env` and let auto-routing kick in. |
| `403 Forbidden`. | Token is from a different project, has been revoked, or is a *read* token instead of a *write* token. Re-issue from your project's **Settings → Write tokens**. |
| Records in wrong region. | Same as 401 — `LOGFIRE_BASE_URL` overrides the token region. Remove the env var or align them. |
| Last few records missing after short script exits. | Call `logfire.force_flush()` before exit (atexit handler covers most cases already). |
| Token has trailing newline / spaces from copy-paste. | Already handled — the setup strips whitespace before passing the token to Logfire. |

---

## 8. Further reading

- **Logfire docs:** <https://logfire.pydantic.dev/docs>
- **SDK reference:** <https://logfire.pydantic.dev/docs/api/logfire>
- **OTEL resource attributes:** <https://opentelemetry.io/docs/specs/otel/resource/sdk/>
