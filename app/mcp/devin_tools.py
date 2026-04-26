"""MCP tools — thin wrappers around the Devin v1 API.

Each tool:
  1. validates input via Pydantic (extra="forbid" + length / range checks)
  2. delegates to ``app.services.devin.DevinService``
  3. returns a JSON-encoded string (FastMCP's native tool return type)

Designed to be consumed by two LLM agents:

    Planner agent
        Reads a user request, decomposes it, and calls
        ``devin_run_implement_and_pr`` (or ``devin_create_session`` directly)
        per task. Tags each session with the user / run id so the monitor
        can find them later.

    Monitor agent
        Woken on session state transitions. Reads the typed
        ``structured_output`` to decide retry / nudge / mark-complete and
        uses ``devin_send_message`` to push corrections back into a running
        session.

The PR-flow ``structured_output_schema`` is hardcoded into
``devin_run_implement_and_pr`` so the planner never has to remember it.
"""

from __future__ import annotations

import json as _json
import logging
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field

from app.services.devin import DevinAPIError, DevinService, get_devin_service

logger = logging.getLogger(__name__)


# ─── Shared output schema for the implement-and-PR flow ───────────────────
# Hardcoded once and reused by ``devin_run_implement_and_pr`` so the planner
# never has to compose this. Tweaking the contract = one place to edit.

PR_FLOW_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["status", "summary"],
    "properties": {
        "status": {
            "type": "string",
            "enum": ["pr_opened", "pr_failed", "tests_failed", "blocked"],
            "description": "Terminal outcome of the run.",
        },
        "pr_url": {"type": "string", "description": "Full URL of the PR Devin opened."},
        "pr_number": {"type": "integer"},
        "pr_branch": {"type": "string"},
        "tests_passed": {"type": "boolean"},
        "lint_passed": {"type": "boolean"},
        "files_changed": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string", "description": "Short human-readable summary of the run."},
        "blockers": {
            "type": "array",
            "items": {"type": "string"},
            "description": "If status='blocked', list every blocker in plain English.",
        },
    },
}


# ─── Pydantic input models ────────────────────────────────────────────────


class ListSessionsInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    tags: Optional[list[str]] = Field(default=None, description="Filter sessions whose tag set contains these.")
    user_email: Optional[str] = Field(default=None, description="Filter by creator email.")
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class SessionIdInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    session_id: str = Field(..., min_length=1, description="Devin session id (e.g. 'devin-abc123').")


class TailMessagesInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    session_id: str = Field(..., min_length=1)
    since_index: int = Field(default=0, ge=0, description="Return messages with index >= this (cheap monitor poll).")


class CreateSessionInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    prompt: str = Field(..., min_length=1, description="Full instruction for Devin.")
    title: Optional[str] = None
    tags: Optional[list[str]] = Field(default=None, max_length=50)
    playbook_id: Optional[str] = None
    knowledge_ids: Optional[list[str]] = Field(
        default=None,
        description="If None, all knowledge applies. If [], no knowledge applies.",
    )
    secret_ids: Optional[list[str]] = Field(
        default=None,
        description="If None, all secrets are available. If [], no secrets.",
    )
    snapshot_id: Optional[str] = None
    max_acu_limit: Optional[int] = Field(default=None, gt=0)
    idempotent: bool = Field(default=False, description="If true, identical prompts dedupe to the same session_id.")
    unlisted: bool = False
    structured_output_schema: Optional[dict[str, Any]] = Field(
        default=None,
        description="JSON Schema (Draft 7) the agent's final result must validate against.",
    )


class SendMessageInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    session_id: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1, description="Mid-run instruction or clarification.")


class UpdateTagsInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    session_id: str = Field(..., min_length=1)
    tags: list[str] = Field(..., max_length=50)


class RunImplementAndPRInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    repo_url: str = Field(..., min_length=1, description="Full HTTPS git repo URL.")
    branch: str = Field(default="main", min_length=1, description="Branch to base the work off.")
    task_description: str = Field(..., min_length=1, description="What the user asked for, in plain English.")
    user_id: str = Field(..., min_length=1, description="End-user id; used as 'user:<id>' tag.")
    run_id: Optional[str] = Field(default=None, description="Optional planner-side run id; tagged as 'run:<id>'.")
    extra_tags: Optional[list[str]] = None
    max_acu_limit: Optional[int] = Field(default=None, gt=0)
    idempotent: bool = False


# ─── Helper ───────────────────────────────────────────────────────────────


def _dump(obj: Any) -> str:
    """JSON-encode for FastMCP. Mirrors ``app.services.surreal.dumps``."""
    return _json.dumps(obj, indent=2, default=str)


def _err_payload(e: DevinAPIError) -> dict[str, Any]:
    """Convert a DevinAPIError to a structured payload the agent can reason about."""
    return {"error": True, "status": e.status, "endpoint": e.endpoint, "detail": e.detail}


def _slice_messages(session: dict[str, Any], since_index: int) -> dict[str, Any]:
    """Pull the messages slice from a session record, with a stable shape."""
    msgs = session.get("messages") or []
    if not isinstance(msgs, list):
        msgs = []
    sliced = msgs[since_index:] if since_index > 0 else msgs
    return {
        "session_id": session.get("session_id"),
        "status": session.get("status"),
        "status_enum": session.get("status_enum"),
        "total_messages": len(msgs),
        "since_index": since_index,
        "next_index": len(msgs),
        "messages": sliced,
    }


# ─── Tool registration ────────────────────────────────────────────────────


def register_devin_tools(mcp: FastMCP) -> None:
    """Attach every ``devin_*`` tool to the given FastMCP instance."""
    svc: DevinService = get_devin_service()

    RO = {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
    WRITE = {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False}
    DESTRUCTIVE = {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": True, "openWorldHint": False}

    # ── Read tools ───────────────────────────────────────────────────────

    @mcp.tool(name="devin_list_sessions", annotations={**RO, "title": "List Devin sessions"})
    async def devin_list_sessions(params: ListSessionsInput) -> str:
        """List sessions, optionally filtered by tag or creator email.

        Common filters: ``tags=['user:42']`` to find every run for a user, or
        ``tags=['run:abc']`` to find the sessions that belong to one planner run.
        """
        try:
            rows = await svc.list_sessions(
                limit=params.limit,
                offset=params.offset,
                tags=params.tags,
                user_email=params.user_email,
            )
            return _dump({"sessions": rows, "count": len(rows)})
        except DevinAPIError as e:
            return _dump(_err_payload(e))

    @mcp.tool(name="devin_get_session", annotations={**RO, "title": "Inspect one Devin session"})
    async def devin_get_session(params: SessionIdInput) -> str:
        """Full session record: ``status_enum``, ``messages``, ``pull_request``, ``structured_output``.

        Prefer ``devin_get_session_status`` or ``devin_tail_messages`` if you only
        need a slice — those are far cheaper for tight monitor loops.
        """
        try:
            data = await svc.get_session(params.session_id)
            return _dump(data)
        except DevinAPIError as e:
            return _dump(_err_payload(e))

    @mcp.tool(name="devin_get_session_status", annotations={**RO, "title": "Cheap status poll"})
    async def devin_get_session_status(params: SessionIdInput) -> str:
        """Just the status fields — use this for tight polling loops.

        Returns ``{session_id, status, status_enum}`` only — drops the messages
        array so the response stays small even when Devin has been running for
        a long time.
        """
        try:
            data = await svc.get_session(params.session_id)
            return _dump({
                "session_id": data.get("session_id"),
                "status": data.get("status"),
                "status_enum": data.get("status_enum"),
                "updated_at": data.get("updated_at"),
            })
        except DevinAPIError as e:
            return _dump(_err_payload(e))

    @mcp.tool(name="devin_tail_messages", annotations={**RO, "title": "Tail new messages from a session"})
    async def devin_tail_messages(params: TailMessagesInput) -> str:
        """Return messages with index >= ``since_index``.

        The monitor agent should remember its last ``next_index`` and pass it
        back as ``since_index`` next tick — that way each poll only returns
        what's new, regardless of how chatty Devin has been.
        """
        try:
            data = await svc.get_session(params.session_id)
            return _dump(_slice_messages(data, params.since_index))
        except DevinAPIError as e:
            return _dump(_err_payload(e))

    @mcp.tool(name="devin_get_structured_output", annotations={**RO, "title": "Read the typed PR-flow result"})
    async def devin_get_structured_output(params: SessionIdInput) -> str:
        """Just the validated ``structured_output`` blob.

        Empty / null until the session reaches a terminal state with
        ``structured_output_schema`` set. The monitor uses this to decide
        retry vs. mark-complete without ever parsing a free-text message.
        """
        try:
            data = await svc.get_session(params.session_id)
            return _dump({
                "session_id": data.get("session_id"),
                "status_enum": data.get("status_enum"),
                "structured_output": data.get("structured_output"),
                "pull_request": data.get("pull_request"),
            })
        except DevinAPIError as e:
            return _dump(_err_payload(e))

    # ── Write tools ──────────────────────────────────────────────────────

    @mcp.tool(name="devin_create_session", annotations={**WRITE, "title": "Start a new Devin session"})
    async def devin_create_session(params: CreateSessionInput) -> str:
        """Start a new Devin session with the given prompt + context.

        Pass ``structured_output_schema`` to force a typed JSON result on the
        ``structured_output`` field. If you want the standard
        implement-and-open-PR contract, prefer ``devin_run_implement_and_pr``
        which sets a sensible schema for you.
        """
        try:
            created = await svc.create_session(**params.model_dump(exclude_none=True))
            return _dump({
                "session_id": created.session_id,
                "url": created.url,
                "is_new_session": created.is_new_session,
            })
        except DevinAPIError as e:
            return _dump(_err_payload(e))

    @mcp.tool(name="devin_send_message", annotations={**WRITE, "title": "Send a message to a running session"})
    async def devin_send_message(params: SendMessageInput) -> str:
        """Push a mid-run instruction or clarification into a running session.

        Typical monitor uses: "the test you just ran is flaky, retry once",
        "also push to the staging registry", "your PR description is missing
        the issue link, please add it".
        """
        try:
            data = await svc.send_message(params.session_id, params.message)
            return _dump(data)
        except DevinAPIError as e:
            return _dump(_err_payload(e))

    @mcp.tool(name="devin_update_tags", annotations={**WRITE, "title": "Replace a session's tag set"})
    async def devin_update_tags(params: UpdateTagsInput) -> str:
        """Replace the tag set on a session.

        Common pattern: tag with ``user:<id>`` and ``run:<id>`` at create time
        so the monitor (and the UX sidebar) can later list every session for a
        given user or planner run.
        """
        try:
            data = await svc.update_tags(params.session_id, params.tags)
            return _dump(data)
        except DevinAPIError as e:
            return _dump(_err_payload(e))

    @mcp.tool(name="devin_terminate_session", annotations={**DESTRUCTIVE, "title": "Cancel a Devin session"})
    async def devin_terminate_session(params: SessionIdInput) -> str:
        """Cancel a session. Once terminated it cannot be resumed.

        Use sparingly — prefer ``devin_send_message`` to course-correct rather
        than killing the run.
        """
        try:
            data = await svc.terminate_session(params.session_id)
            return _dump(data)
        except DevinAPIError as e:
            return _dump(_err_payload(e))

    # ── Opinionated wrapper: the planner's main entry point ──────────────

    @mcp.tool(name="devin_run_implement_and_pr", annotations={**WRITE, "title": "Run implement+test+PR with typed output"})
    async def devin_run_implement_and_pr(params: RunImplementAndPRInput) -> str:
        """Kick off a Devin session that must implement, test, and open a PR.

        Wraps ``create_session`` with:
          - a canned prompt enforcing PR discipline (no main-branch commits)
          - the ``PR_FLOW_OUTPUT_SCHEMA`` so the result is typed and machine-checkable
          - automatic ``user:<id>`` and (optional) ``run:<id>`` tags so the
            monitor and the UX sidebar can find this run later

        The planner just describes the task; this tool handles the rest.
        """
        tags = [f"user:{params.user_id}"]
        if params.run_id:
            tags.append(f"run:{params.run_id}")
        if params.extra_tags:
            tags.extend(params.extra_tags)

        prompt = (
            "You are working on the repository at the URL below. Implement the task, "
            "test thoroughly, and open a pull request — do NOT push to the base branch.\n\n"
            f"Repository: {params.repo_url}\n"
            f"Base branch: {params.branch}\n\n"
            "Task:\n"
            f"{params.task_description}\n\n"
            "Workflow you must follow:\n"
            "  1. Clone the repo and check out the base branch.\n"
            "  2. Create a new feature branch with a descriptive name.\n"
            "  3. Implement the change. Follow the repo's existing code style and conventions.\n"
            "  4. Add or update tests as needed and run the project's test + lint suite.\n"
            "  5. Push the branch and open a PR back to the base branch.\n"
            "  6. Return a structured result matching the schema you've been given.\n\n"
            "If anything blocks you (missing credentials, ambiguous requirements, failing tests "
            "you can't fix), set status='blocked' and list each blocker in plain English."
        )

        try:
            created = await svc.create_session(
                prompt=prompt,
                title=f"[user:{params.user_id}] {params.task_description[:80]}",
                tags=tags,
                max_acu_limit=params.max_acu_limit,
                idempotent=params.idempotent,
                structured_output_schema=PR_FLOW_OUTPUT_SCHEMA,
            )
            return _dump({
                "session_id": created.session_id,
                "url": created.url,
                "is_new_session": created.is_new_session,
                "tags": tags,
            })
        except DevinAPIError as e:
            return _dump(_err_payload(e))

    # ── Health ───────────────────────────────────────────────────────────

    @mcp.tool(name="devin_health", annotations={**RO, "title": "Devin connectivity check"})
    async def devin_health() -> str:
        """Sanity-check the Devin API key by listing one session.

        Returns ``{"ok": true, "reachable": true}`` on success, or the structured
        error payload on failure — works without a live SurrealDB so it's safe
        to call from the top-level health endpoint.
        """
        try:
            rows = await svc.list_sessions(limit=1)
            return _dump({"ok": True, "reachable": True, "sample_count": len(rows)})
        except DevinAPIError as e:
            return _dump({"ok": False, **_err_payload(e)})
