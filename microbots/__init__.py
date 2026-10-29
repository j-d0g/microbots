"""Shared logging and instrumentation helpers."""

from microbots.log import (
    CORRELATION_ID,
    get_correlation_id,
    get_logger,
    instrument,
    setup_logging,
    span,
)
from microbots.observability import (
    instrument_fastapi,
    instrument_httpx,
    instrument_pydantic_ai,
)

__all__ = [
    "CORRELATION_ID",
    "get_correlation_id",
    "get_logger",
    "instrument",
    "instrument_fastapi",
    "instrument_httpx",
    "instrument_pydantic_ai",
    "setup_logging",
    "span",
]
