# test/ — Manual demos for the logging facade

Runnable scripts that emit sample records so you can eyeball exactly
what the central logger in `microbots/log.py` produces.

> This is **not a pytest suite**. These scripts just print stuff. If
> `LOGFIRE_TOKEN` is set in `.env`, the same records are also shipped
> to <https://logfire-eu.pydantic.dev>.

## Run everything

```bash
# Preferred — uses the uv-managed venv which has all deps.
uv run python test/test_logging.py
```

> **Note on plain `python`:** running `python test/test_logging.py`
> directly only works if your active Python interpreter has the
> project's deps (`logfire`, `python-dotenv`, `surrealdb`). If you see
> `ModuleNotFoundError: No module named 'logfire'`, use `uv run` above,
> or activate the venv first:
>
> ```bash
> .venv/Scripts/python test/test_logging.py   # Windows
> .venv/bin/python test/test_logging.py       # macOS / Linux
> ```

You'll see a banner with this run's `correlation_id` (12-char hex),
then nine scenarios in order. Every record carries that
correlation_id as a resource attribute — copy it and paste into the
Logfire UI filter to see the whole run on one page.

## Run a single scenario

```bash
uv run python test/test_logging.py 3            # scenario 3 only
uv run python test/test_logging.py 1,4,7        # scenarios 1, 4, 7
```

## What each scenario demonstrates

| # | Name                     | Shows |
|---|--------------------------|-------|
| 1 | every severity level     | `debug` / `info` / `notice` / `warn` / `error` / `fatal` all emit correctly with attributes |
| 2 | structured / templated   | `kwargs` become queryable attrs; `{placeholder}` syntax interpolates + records attrs |
| 3 | spans (nested, attrs)    | `with span(...)` context manager, nested spans, `set_attribute` mid-span |
| 4 | `@instrument` decorator  | Sync + async functions auto-wrapped into spans |
| 5 | exceptions + tracebacks  | `log.exception()` attaches traceback; exception inside span marks span errored |
| 6 | correlation id           | Shows this run's id + how to filter / propagate it |
| 7 | async workflow           | Realistic multi-step async pipeline with spans at every step |
| 8 | multiple loggers         | Per-module tags (`demo.auth`, `demo.db`, `demo.http`) — filterable in UI |
| 9 | load (25 records)        | Rapid-fire records to eyeball batching / flushing |

## Verifying correlation_id behavior

Run the script twice back-to-back — the `correlation_id` in the banner
line should be **different** each run (unique per process).

Override it for a run:

```bash
# bash
CORRELATION_ID=my-debug-run-1 uv run python test/test_logging.py 3

# PowerShell
$env:CORRELATION_ID="my-debug-run-1"; uv run python test/test_logging.py 3
```

The whole run's records will tag `correlation_id=my-debug-run-1`,
which is handy when you're reproducing a bug and want to name the
session.

## Shipping to Logfire

1. Drop a write token into `.env`:

   ```
   LOGFIRE_TOKEN=lwt_...
   ```

2. Run the script.

3. In <https://logfire-eu.pydantic.dev> → your project, filter:

   ```
   correlation_id = "<the 12-char id printed in the banner>"
   ```

   You should see all the records from that run, each with their tag
   (e.g. `demo.spans`, `demo.pipeline`) and their attributes.
