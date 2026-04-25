"""microbots — Agent Memory Graph package.

Public re-exports for the centralized observability layer:

    from microbots import get_logger, span, instrument, get_correlation_id

    log = get_logger(__name__)
    log.info("hello {user}", user="alice")
"""

from microbots.log import (
    CORRELATION_ID,
    get_correlation_id,
    get_logger,
    instrument,
    setup_logging,
    span,
)

__all__ = [
    "CORRELATION_ID",
    "get_correlation_id",
    "get_logger",
    "instrument",
    "setup_logging",
    "span",
]
