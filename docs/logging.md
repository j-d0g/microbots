# Logging

The Python API and KG scripts use [Pydantic Logfire](https://logfire.pydantic.dev)
through `microbots/log.py`. With `LOGFIRE_TOKEN` unset, records stay in the local
console. A write token additionally sends records to Logfire; it is optional for
development and tests.

`app/main.py` initializes logging, instruments FastAPI and HTTPX, and forwards
standard-library logging through Logfire. The wiki agent instruments Pydantic AI.
The shared helpers in `microbots/observability.py` configure this instrumentation
idempotently. There is no autonomous self-improvement loop.

## Configuration

Set these in the root `.env` and restart the process:

| Variable | Default / purpose |
| --- | --- |
| `LOGFIRE_TOKEN` | Empty: console only. Optional Logfire write token. |
| `LOGFIRE_SERVICE_NAME` | `microbots` |
| `LOGFIRE_ENVIRONMENT` | `dev` |
| `LOGFIRE_BASE_URL` | Inferred from EU/US token prefixes; EU fallback. Optional override. |
| `CORRELATION_ID` | Generated 12-character ID per process; set to link related processes. |

The startup banner reports the service, environment, region, and whether remote
shipping is enabled. If exports fail with 401/403, check the write token and its
region; remove an incorrect `LOGFIRE_BASE_URL` override.

## Helpers

```python
from microbots import get_logger, span

log = get_logger(__name__)
with span("db.query", table="entity"):
    log.info("querying entities")
```

`get_logger`, `span`, and the `instrument` decorator lazily initialize logging.
`get_correlation_id()` returns the process ID used to correlate its records;
`setup_logging()` is available for explicit initialization.
