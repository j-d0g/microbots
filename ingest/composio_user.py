"""Resolve effective Composio user_id from connected accounts."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from composio_client import Composio as ComposioClient

log = logging.getLogger(__name__)


@dataclass
class ResolvedComposioUser:
    user_id: str
    reason: str


def _toolkits_for_integrations(integrations: list[str]) -> list[str]:
    out: list[str] = []
    for i in integrations:
        slug = i.lower().strip()
        if slug == "perplexity":
            slug = "perplexityai"
        if slug and slug not in out:
            out.append(slug)
    return out


def _candidate_user_ids(requested_user_id: str) -> list[str]:
    org_id = os.getenv("COMPOSIO_ORG_ID", "").strip()
    raw = requested_user_id.strip()
    if not raw:
        return ["default"]
    core = raw
    if core.startswith("pg-test-"):
        core = core[len("pg-test-") :]
    if core.startswith("consumer-"):
        # Keep as-is; parsing consumer format can be ambiguous.
        pass
    cands = [raw, core, f"pg-test-{core}"]
    if org_id:
        cands.extend(
            [
                f"consumer-{core}-{org_id}",
                f"consumer-{raw}-{org_id}",
            ]
        )
    # Preserve order; de-duplicate.
    seen: set[str] = set()
    deduped: list[str] = []
    for c in cands:
        if c and c not in seen:
            deduped.append(c)
            seen.add(c)
    return deduped


def _active_count_for_user(
    client: ComposioClient, user_id: str, toolkit_slugs: list[str]
) -> int:
    res = client.connected_accounts.list(
        user_ids=[user_id],
        toolkit_slugs=toolkit_slugs or None,
        statuses=["ACTIVE"],
        limit=100,
    )
    return len(getattr(res, "items", []) or [])


def resolve_composio_user_id(
    *,
    api_key: str,
    requested_user_id: str,
    integrations: list[str],
) -> ResolvedComposioUser:
    """
    Determine the user_id to pass to tools.execute.

    Strategy:
    1) Try requested id and common aliases.
    2) If none match, inspect all ACTIVE accounts for this API key.
       - if exactly one user_id is present, use it.
       - else keep requested and surface actionable diagnostics.
    """
    toolkits = _toolkits_for_integrations(integrations)
    client = ComposioClient(api_key=api_key)

    best_uid = requested_user_id
    best_count = 0
    for uid in _candidate_user_ids(requested_user_id):
        try:
            cnt = _active_count_for_user(client, uid, toolkits)
        except Exception as e:  # noqa: BLE001
            log.debug("Composio user check failed for %r: %s", uid, e)
            continue
        if cnt > best_count:
            best_uid = uid
            best_count = cnt
    if best_count > 0:
        if best_uid != requested_user_id:
            return ResolvedComposioUser(
                user_id=best_uid,
                reason=(
                    f"resolved from COMPOSIO_USER_ID={requested_user_id!r} "
                    f"to {best_uid!r} ({best_count} ACTIVE account(s) for enabled toolkits)"
                ),
            )
        return ResolvedComposioUser(
            user_id=requested_user_id,
            reason=f"verified {best_count} ACTIVE account(s) for enabled toolkits",
        )

    # No matches from requested/candidates. Inspect all active accounts this key can see.
    res_all = client.connected_accounts.list(
        toolkit_slugs=toolkits or None,
        statuses=["ACTIVE"],
        limit=100,
    )
    items = getattr(res_all, "items", []) or []
    user_ids = sorted(
        {
            str(getattr(i, "user_id", "")).strip()
            for i in items
            if str(getattr(i, "user_id", "")).strip()
        }
    )
    if len(user_ids) == 1:
        return ResolvedComposioUser(
            user_id=user_ids[0],
            reason=(
                "auto-selected sole ACTIVE connected-account user_id visible "
                f"to this API key: {user_ids[0]!r}"
            ),
        )

    if len(items) == 0:
        raise RuntimeError(
            "Composio API key has zero ACTIVE connected accounts for enabled toolkits. "
            "This is usually a project/API-key mismatch (or no links created yet). "
            "Run `composio dev init` for the intended project, create links there, and use that "
            "project's COMPOSIO_API_KEY."
        )

    raise RuntimeError(
        "Could not resolve COMPOSIO_USER_ID to an ACTIVE connected account. "
        f"Requested={requested_user_id!r}; candidate matches=0; "
        f"visible user_ids for this key={user_ids}. "
        "Set COMPOSIO_USER_ID to one of the visible values or relink toolkits under the requested user."
    )
