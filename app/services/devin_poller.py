"""Per-session async poller — turns Devin's poll-only API into an event stream.

Devin has no native streaming endpoint; ``GET /v1/sessions/{id}`` returns the
full message list every call. This module wraps that in a single background
task per session that:

  1. Polls on a fixed interval (default 3s).
  2. Diffs the messages array and the ``status_enum`` field.
  3. Publishes events to one ``asyncio.Queue`` per subscriber.

Subscribers are usually the SSE endpoint in ``app/routes/api_devin.py``, which
opens a queue per HTTP connection and forwards events to the browser. Many
subscribers can share one poller — Devin only sees one HTTP request per
``poll_interval`` regardless of how many UX tabs are open.

Lifecycle:
  - ``subscribe(session_id)`` returns an async iterator of events. The first
    event is a ``snapshot`` carrying the current state; subsequent events
    carry only deltas.
  - The poller stops once ``status_enum`` is terminal (``finished`` /
    ``expired``) **and** there are no subscribers left, with a small TTL
    grace period so refreshing the UX doesn't drop the stream.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

from app.services.devin import DevinAPIError, DevinService, get_devin_service

logger = logging.getLogger(__name__)

# Tunables — env-overridable from `app/main.py` if we ever need to.
POLL_INTERVAL_SECONDS = 3.0
IDLE_TTL_SECONDS = 30.0       # keep poller alive for this long after the last subscriber disconnects
QUEUE_MAXSIZE = 256            # per-subscriber queue cap; older events drop on overflow


@dataclass(slots=True)
class SessionEvent:
    """One event pushed to subscribers.

    ``type`` values:
      * ``snapshot``       — full current state on subscribe
      * ``messages``       — one or more new messages appended
      * ``status``         — ``status_enum`` changed
      * ``structured``     — ``structured_output`` populated (terminal-ish)
      * ``done``           — session reached a terminal status
      * ``error``          — poll roundtrip failed (transient)
    """

    type: str
    session_id: str
    data: dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "session_id": self.session_id, "data": self.data, "ts": self.ts}


@dataclass
class _SessionState:
    """Bookkeeping for one session being polled."""

    session_id: str
    subscribers: list[asyncio.Queue[SessionEvent]] = field(default_factory=list)
    last_message_count: int = 0
    last_status: Optional[str] = None
    last_structured: Any = None
    task: Optional[asyncio.Task[None]] = None
    last_subscriber_left_at: Optional[float] = None
    done: bool = False


class DevinPoller:
    """Singleton coordinator. Created lazily from ``get_devin_poller()``."""

    def __init__(
        self,
        devin: Optional[DevinService] = None,
        *,
        poll_interval: float = POLL_INTERVAL_SECONDS,
        idle_ttl: float = IDLE_TTL_SECONDS,
    ) -> None:
        self._devin = devin or get_devin_service()
        self._poll_interval = poll_interval
        self._idle_ttl = idle_ttl
        self._sessions: dict[str, _SessionState] = {}
        self._lock = asyncio.Lock()

    # ── Subscription API ──────────────────────────────────────────────────

    async def subscribe(self, session_id: str) -> AsyncIterator[SessionEvent]:
        """Async iterator yielding events for one session.

        Always emits one ``snapshot`` event first (synchronous initial fetch)
        so the SSE consumer can paint the current state immediately, then
        delta events as they arrive.
        """
        queue: asyncio.Queue[SessionEvent] = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        async with self._lock:
            state = self._sessions.get(session_id)
            if state is None:
                state = _SessionState(session_id=session_id)
                self._sessions[session_id] = state
                state.task = asyncio.create_task(
                    self._poll_loop(state),
                    name=f"devin-poll-{session_id}",
                )
            state.subscribers.append(queue)
            state.last_subscriber_left_at = None

        try:
            # Synthesise a snapshot from current state so the new subscriber
            # gets context immediately rather than waiting for the next tick.
            snapshot = await self._snapshot(session_id, state)
            if snapshot is not None:
                yield snapshot

            while True:
                try:
                    event = await queue.get()
                except asyncio.CancelledError:
                    break
                yield event
                if event.type == "done":
                    break
        finally:
            await self._unsubscribe(session_id, queue)

    async def _unsubscribe(self, session_id: str, queue: asyncio.Queue[SessionEvent]) -> None:
        async with self._lock:
            state = self._sessions.get(session_id)
            if state is None:
                return
            try:
                state.subscribers.remove(queue)
            except ValueError:
                pass
            if not state.subscribers:
                state.last_subscriber_left_at = time.time()

    # ── Internal: fetch + dispatch ────────────────────────────────────────

    async def _snapshot(self, session_id: str, state: _SessionState) -> Optional[SessionEvent]:
        """Fetch the session once and return a snapshot event.

        Bootstrapping a new subscriber: we deliberately do *not* trust the
        polling task to deliver the first event — a fresh subscribe call
        should never have to wait ``poll_interval`` seconds for any data.
        """
        try:
            data = await self._devin.get_session(session_id)
        except DevinAPIError as e:
            logger.warning("snapshot fetch failed for %s: %s", session_id, e)
            return SessionEvent(type="error", session_id=session_id, data={"detail": str(e)})

        msgs = data.get("messages") or []
        # First subscriber for this session — seed the diff baseline so the
        # poller doesn't immediately resend everything as a delta.
        if state.last_message_count == 0 and not state.last_status:
            state.last_message_count = len(msgs)
            state.last_status = data.get("status_enum")
            state.last_structured = data.get("structured_output")

        return SessionEvent(
            type="snapshot",
            session_id=session_id,
            data={
                "status": data.get("status"),
                "status_enum": data.get("status_enum"),
                "messages": msgs,
                "total_messages": len(msgs),
                "pull_request": data.get("pull_request"),
                "structured_output": data.get("structured_output"),
                "tags": data.get("tags"),
                "title": data.get("title"),
                "url": data.get("url") or data.get("session_url"),
            },
        )

    async def _poll_loop(self, state: _SessionState) -> None:
        """Background loop — runs until terminal + idle-ttl expired."""
        sid = state.session_id
        logger.info("starting poll loop for %s", sid)
        try:
            while True:
                # Fast exit: terminal status AND no subscribers for `idle_ttl` seconds.
                if state.done and self._should_stop(state):
                    logger.info("stopping poll loop for %s (terminal + idle)", sid)
                    return

                await asyncio.sleep(self._poll_interval)

                try:
                    data = await self._devin.get_session(sid)
                except DevinAPIError as e:
                    self._broadcast(state, SessionEvent(
                        type="error",
                        session_id=sid,
                        data={"status": e.status, "detail": str(e.detail)},
                    ))
                    # Ephemeral 4xx/5xx — keep polling unless it's a permanent 404.
                    if e.status == 404:
                        logger.warning("session %s no longer exists; stopping", sid)
                        self._broadcast(state, SessionEvent(type="done", session_id=sid, data={"reason": "not_found"}))
                        state.done = True
                    continue
                except Exception:  # noqa: BLE001
                    logger.exception("unexpected error polling %s", sid)
                    continue

                msgs = data.get("messages") or []
                status = data.get("status_enum")
                structured = data.get("structured_output")

                # Message deltas.
                if len(msgs) > state.last_message_count:
                    new_msgs = msgs[state.last_message_count:]
                    self._broadcast(state, SessionEvent(
                        type="messages",
                        session_id=sid,
                        data={"messages": new_msgs, "next_index": len(msgs)},
                    ))
                    state.last_message_count = len(msgs)

                # Status transitions.
                if status != state.last_status:
                    self._broadcast(state, SessionEvent(
                        type="status",
                        session_id=sid,
                        data={"from": state.last_status, "to": status},
                    ))
                    state.last_status = status

                # Structured output appearing for the first time / changing.
                if structured is not None and structured != state.last_structured:
                    self._broadcast(state, SessionEvent(
                        type="structured",
                        session_id=sid,
                        data={"structured_output": structured},
                    ))
                    state.last_structured = structured

                # Terminal — emit ``done`` once and start the idle timer.
                if not state.done and self._devin.is_terminal_status(status):
                    self._broadcast(state, SessionEvent(
                        type="done",
                        session_id=sid,
                        data={
                            "status_enum": status,
                            "structured_output": structured,
                            "pull_request": data.get("pull_request"),
                        },
                    ))
                    state.done = True
                    if not state.subscribers:
                        state.last_subscriber_left_at = time.time()
        finally:
            async with self._lock:
                self._sessions.pop(sid, None)

    def _should_stop(self, state: _SessionState) -> bool:
        if state.subscribers:
            return False
        if state.last_subscriber_left_at is None:
            return True
        return (time.time() - state.last_subscriber_left_at) >= self._idle_ttl

    def _broadcast(self, state: _SessionState, event: SessionEvent) -> None:
        """Fan-out an event to every subscriber queue.

        Drops events on full queues rather than blocking — a slow consumer
        must not stall the poller (or the other consumers).
        """
        for q in list(state.subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning(
                    "subscriber queue full for %s; dropping event %s",
                    state.session_id,
                    event.type,
                )

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def shutdown(self) -> None:
        """Cancel every poll task. Called from the FastAPI lifespan exit."""
        async with self._lock:
            tasks = [s.task for s in self._sessions.values() if s.task is not None]
            self._sessions.clear()
        for t in tasks:
            t.cancel()
        for t in tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass


_poller_singleton: Optional[DevinPoller] = None


def get_devin_poller() -> DevinPoller:
    """Module-level singleton. Created lazily on first call."""
    global _poller_singleton
    if _poller_singleton is None:
        _poller_singleton = DevinPoller()
    return _poller_singleton


async def shutdown_devin_poller() -> None:
    """Helper for the FastAPI lifespan teardown."""
    global _poller_singleton
    if _poller_singleton is not None:
        await _poller_singleton.shutdown()
        _poller_singleton = None
