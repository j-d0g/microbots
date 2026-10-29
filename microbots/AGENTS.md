# Shared observability helpers

`log.py` provides local-first logging and Logfire setup. `observability.py`
contains optional tracing helpers and integrations for FastAPI, HTTPX, and
Pydantic AI. Keep logging functional when `LOGFIRE_TOKEN` is unset.
