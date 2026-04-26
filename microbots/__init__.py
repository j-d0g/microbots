"""microbots — Agent Memory Graph package.

Public re-exports for the centralized observability layer:

    from microbots import get_logger, span, instrument, get_correlation_id

    log = get_logger(__name__)
    log.info("hello {user}", user="alice")

Self-improvement primitives (see microbots/observability.py):

    from microbots import (
        traced_retrieval,
        emit_failure_mode,
        instrument_pydantic_ai,
        query_logfire,
    )
"""

from microbots.log import (
    CORRELATION_ID,
    get_correlation_id,
    get_logger,
    instrument,
    setup_logging,
    span,
)
from microbots.observability import (
    KNOWN_FAILURE_MODES,
    emit_failure_mode,
    instrument_fastapi,
    instrument_httpx,
    instrument_pydantic_ai,
    query_logfire,
    record_retrieval,
    traced_retrieval,
)

__all__ = [
    "CORRELATION_ID",
    "KNOWN_FAILURE_MODES",
    "emit_failure_mode",
    "get_correlation_id",
    "get_logger",
    "instrument",
    "instrument_fastapi",
    "instrument_httpx",
    "instrument_pydantic_ai",
    "query_logfire",
    "record_retrieval",
    "setup_logging",
    "span",
    "traced_retrieval",
]
