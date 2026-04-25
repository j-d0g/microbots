"""JSON service registry — the source of truth mapping local paths to Render services.

Thread/process safety: every read-modify-write sequence takes an exclusive
:mod:`portalocker` lock on a sibling ``.lock`` file so concurrent deploys
cannot corrupt the registry.
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path

import portalocker

from .exceptions import RegistryCorruptError
from .models import RegistryEntry

logger = logging.getLogger("render_sdk")

REGISTRY_VERSION = 1
_LOCK_TIMEOUT_S = 30


class ServiceRegistry:
    """Manages the JSON file that maps local folder paths → Render service metadata.

    File format::

        {
          "version": 1,
          "services": {
            "/absolute/path/to/folder": { ...RegistryEntry fields... },
            ...
          }
        }
    """

    def __init__(self, registry_path: str | Path):
        self.path = Path(registry_path).expanduser().resolve()
        self.lock_path = self.path.with_suffix(".lock")
        self._ensure_exists()

    # ── Private helpers ─────────────────────────────────────────────────────

    def _ensure_exists(self) -> None:
        """Create the registry file with an empty structure if it doesn't exist."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write_raw({"version": REGISTRY_VERSION, "services": {}})
            logger.debug("[registry] Created new registry at %s", self.path)

    def _read_raw(self) -> dict:
        """Read and parse the JSON file. Raises :class:`RegistryCorruptError` on failure."""
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            # Back up the corrupt file before raising so the user can inspect it.
            backup = self.path.with_suffix(".bak")
            shutil.copy2(self.path, backup)
            logger.error("[registry] Corrupt registry backed up to %s", backup)
            raise RegistryCorruptError(str(self.path), str(e)) from e

    def _write_raw(self, data: dict) -> None:
        """Write data to the registry file atomically.

        ``Path.replace`` is atomic on both POSIX and Windows (since Python 3.3)
        when source and destination are on the same filesystem.
        """
        tmp = self.path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        tmp.replace(self.path)

    # ── Public API ──────────────────────────────────────────────────────────

    def lookup(self, normalised_path: str) -> RegistryEntry | None:
        """Return the :class:`RegistryEntry` for a path, or ``None`` if not registered.

        Read-only — no lock needed. A concurrent writer can race us, but the
        worst case is an older snapshot; the caller re-reads under the lock
        when it needs to mutate.
        """
        data = self._read_raw()
        entry_dict = data["services"].get(normalised_path)
        if entry_dict is None:
            logger.debug("[registry] MISS for path: %s", normalised_path)
            return None
        logger.debug("[registry] HIT for path: %s", normalised_path)
        return RegistryEntry.from_dict(entry_dict)

    def register(self, normalised_path: str, entry: RegistryEntry) -> None:
        """Write a new entry.

        Raises :class:`ValueError` if the path is already registered — use
        :meth:`update` for subsequent deploys.
        """
        with portalocker.Lock(str(self.lock_path), timeout=_LOCK_TIMEOUT_S):
            data = self._read_raw()
            if normalised_path in data["services"]:
                raise ValueError(
                    f"Path '{normalised_path}' already registered. Use update() instead."
                )
            data["services"][normalised_path] = entry.to_dict()
            self._write_raw(data)
            logger.info(
                "[registry] Registered new service '%s' for path: %s",
                entry.service_name, normalised_path,
            )

    def update(self, normalised_path: str, **kwargs) -> None:
        """Update specific fields of an existing entry.

        Common ``kwargs``: ``status``, ``last_deployed``, ``deploy_count``,
        ``live_url``.
        """
        with portalocker.Lock(str(self.lock_path), timeout=_LOCK_TIMEOUT_S):
            data = self._read_raw()
            if normalised_path not in data["services"]:
                raise KeyError(
                    f"Path '{normalised_path}' not in registry. Cannot update."
                )
            data["services"][normalised_path].update(kwargs)
            self._write_raw(data)
            logger.debug(
                "[registry] Updated entry for: %s -> %s", normalised_path, kwargs
            )

    def remove(self, normalised_path: str) -> bool:
        """Delete an entry from the registry.

        Returns ``True`` if deleted, ``False`` if the path was not registered.
        """
        with portalocker.Lock(str(self.lock_path), timeout=_LOCK_TIMEOUT_S):
            data = self._read_raw()
            if normalised_path not in data["services"]:
                logger.warning(
                    "[registry] remove() called for unknown path: %s", normalised_path
                )
                return False
            del data["services"][normalised_path]
            self._write_raw(data)
            logger.info("[registry] Removed entry for: %s", normalised_path)
            return True

    def list_all(self) -> dict[str, RegistryEntry]:
        """Return all registry entries as a dict keyed by normalised path."""
        data = self._read_raw()
        return {
            path: RegistryEntry.from_dict(entry)
            for path, entry in data["services"].items()
        }

    def count(self) -> int:
        """Return the number of registered services."""
        return len(self._read_raw()["services"])
