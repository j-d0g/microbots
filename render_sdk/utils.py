"""Shared helpers — path normalisation, slug generation, retry decorator."""

from __future__ import annotations

import hashlib
import logging
import re
import time
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Callable, TypeVar

logger = logging.getLogger("render_sdk")

_T = TypeVar("_T")

# Slug used when the folder basename collapses to an empty string (e.g. "___").
_FALLBACK_SLUG_STEM = "app"


def normalise_path(path: str | Path) -> str:
    """Resolve symlinks, expand ``~``, strip trailing slash.

    Returns a normalised absolute path string. This is the canonical
    registry key.
    """
    return str(Path(path).expanduser().resolve())


def make_slug(path: str) -> str:
    """Derive a Render-safe service name from ``path``.

    Rules:
      - Use only the final directory name (basename).
      - Lowercase.
      - Replace non-alphanumeric chars with hyphens.
      - Collapse consecutive hyphens and strip leading/trailing hyphens.
      - Truncate to 30 chars.
      - Append a 4-char SHA-256 hash of the full path for collision resistance.
      - Result: ``"{slug}-{hash4}"`` e.g. ``"lead-scraper-a1b2"``.

    If the basename collapses to an empty slug (e.g. the folder name is
    all punctuation), falls back to ``"app"`` so the final name is still
    valid.
    """
    folder_name = Path(path).name
    slug = folder_name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    slug = slug[:30].rstrip("-") or _FALLBACK_SLUG_STEM

    path_hash = hashlib.sha256(path.encode()).hexdigest()[:4]
    return f"{slug}-{path_hash}"


def make_image_tag(docker_org: str, slug: str, deploy_count: int) -> str:
    """Build the full Docker image reference.

    Format: ``{docker_org}/{slug}:{deploy_count}``. The ``:latest`` alias
    is tagged separately by :class:`DockerBuilder`.
    """
    return f"{docker_org}/{slug}:{deploy_count}"


def now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def retry(
    times: int = 3,
    delay: float = 5.0,
    exceptions: tuple[type[BaseException], ...] = (Exception,),
) -> Callable[[Callable[..., _T]], Callable[..., _T]]:
    """Retry a function up to ``times`` times on the given exceptions.

    Waits ``delay`` seconds between attempts. ``times`` must be ``>= 1``.
    """
    if times < 1:
        raise ValueError("retry() requires times >= 1")

    def decorator(fn: Callable[..., _T]) -> Callable[..., _T]:
        @wraps(fn)
        def wrapper(*args, **kwargs) -> _T:
            last_exc: BaseException | None = None
            for attempt in range(1, times + 1):
                try:
                    return fn(*args, **kwargs)
                except exceptions as exc:
                    last_exc = exc
                    logger.warning(
                        "[retry] %s attempt %d/%d failed: %s",
                        fn.__name__, attempt, times, exc,
                    )
                    if attempt < times:
                        time.sleep(delay)
            # Unreachable unless exceptions raised; keep mypy happy.
            assert last_exc is not None
            raise last_exc

        return wrapper

    return decorator
