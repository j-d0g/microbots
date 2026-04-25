"""Knowledge-graph write operations — shared by MCP tools and REST endpoints.

Every write goes through one of these async functions, which means MCP and
REST behave identically. Patterns borrowed from
``knowledge_graph/enrich/writers/`` so the schema stays consistent across
the two write paths (ingest enrichment + agent direct writes).

Conventions:
- Identifiers are content-hashed (memory) or slug-based (entity/skill/workflow)
  so re-calling with the same payload is idempotent.
- All multi-statement work uses single ``UPSERT … MERGE`` queries — SurrealDB
  v3 doesn't return values from multi-statement ``LET ... RETURN`` over the
  WebSocket RPC.
- Edges use ``RELATE`` and we de-duplicate with a SELECT-then-RELATE pattern
  rather than ``IF NOT EXISTS`` since SurrealDB v3 lacks the latter on
  RELATE statements.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

from app.services.surreal import jsonify, session

logger = logging.getLogger(__name__)


# ─── Helpers ──────────────────────────────────────────────────────────────


def _slug(text: str) -> str:
    """Lowercase + collapse non-alphanumerics to underscores. Used for ids."""
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s or "unnamed"


def _hash_id(*parts: str, prefix: str = "agent") -> str:
    h = hashlib.sha256("\u200b".join(parts).encode("utf-8")).hexdigest()[:32]
    return f"{prefix}_{h}"


def _rec(table: str, id_part: str) -> RecordID:
    return RecordID(table, id_part)


def _parse_record(s: str) -> Optional[RecordID]:
    """Accept either ``'memory:abc'`` or ``'abc'``; return None if blank."""
    s = (s or "").strip()
    if not s:
        return None
    if ":" in s:
        table, _, idp = s.partition(":")
        return RecordID(table.strip(), idp.strip())
    return None


async def _relate_unique(
    db: AsyncSurreal,
    frm: RecordID,
    relation: str,
    to: RecordID,
    content: Optional[dict] = None,
) -> None:
    """RELATE only if no edge with this exact (in, out) pair exists yet."""
    existing = await db.query(
        f"SELECT id FROM {relation} WHERE in = $f AND out = $t LIMIT 1",
        {"f": frm, "t": to},
    )
    rows = existing[0] if isinstance(existing, list) and existing else []
    if isinstance(rows, list) and rows:
        return
    if content:
        await db.query(
            f"RELATE $f->{relation}->$t CONTENT $c",
            {"f": frm, "t": to, "c": content},
        )
    else:
        await db.query(f"RELATE $f->{relation}->$t", {"f": frm, "t": to})


# ─── Memory ───────────────────────────────────────────────────────────────


async def add_memory(
    *,
    content: str,
    memory_type: str = "fact",
    confidence: float = 0.7,
    source: Optional[str] = None,
    tags: Optional[list[str]] = None,
    chat_id: Optional[str] = None,
    about_entity_id: Optional[str] = None,
    about_integration_slug: Optional[str] = None,
) -> dict[str, Any]:
    """Persist a memory + optional source/about edges. Idempotent via content hash."""
    content = content.strip()
    if not content:
        raise ValueError("content is required")

    mem_id = _hash_id(content, prefix="agent")
    m_rec = _rec("memory", mem_id)

    payload = {
        "content": content,
        "memory_type": memory_type,
        "confidence": float(confidence),
        "tags": list(tags or []),
        "source": source or "agent",
    }

    async with session() as db:
        await db.query(
            "UPSERT $m MERGE $payload",
            {"m": m_rec, "payload": {**payload, "updated_at": datetime.now(timezone.utc)}},
        )
        if chat_id:
            c_rec = _parse_record(chat_id)
            if c_rec:
                await _relate_unique(db, c_rec, "chat_yields", m_rec, {"confidence": confidence})
        if about_entity_id:
            e_rec = _parse_record(about_entity_id)
            if e_rec:
                await _relate_unique(db, m_rec, "memory_about", e_rec, {"relevance": confidence * 0.9})
        if about_integration_slug:
            i_rec = _rec("integration", about_integration_slug.strip().lower())
            await _relate_unique(db, m_rec, "memory_about", i_rec, {"relevance": confidence})

    return {"id": str(m_rec), "memory_id": mem_id}


# ─── Entity ───────────────────────────────────────────────────────────────


async def upsert_entity(
    *,
    name: str,
    entity_type: str,
    description: Optional[str] = None,
    aliases: Optional[list[str]] = None,
    tags: Optional[list[str]] = None,
    appears_in_integration: Optional[str] = None,
    appears_in_handle: Optional[str] = None,
    appears_in_role: Optional[str] = None,
) -> dict[str, Any]:
    """Add-or-merge an entity by ``(entity_type, name)``."""
    name = name.strip()
    if not name:
        raise ValueError("name is required")
    entity_type = entity_type.strip().lower()

    ent_slug = f"{entity_type}_{_slug(name)}"
    e_rec = _rec("entity", ent_slug)

    payload = {
        "name": name,
        "entity_type": entity_type,
        "description": description,
        "aliases": list(aliases or []),
        "tags": list(tags or []),
    }

    async with session() as db:
        await db.query(
            "UPSERT $e MERGE $payload",
            {"e": e_rec, "payload": {**payload, "updated_at": datetime.now(timezone.utc)}},
        )
        if appears_in_integration:
            i_rec = _rec("integration", appears_in_integration.strip().lower())
            edge_content = {}
            if appears_in_handle: edge_content["handle"] = appears_in_handle
            if appears_in_role:   edge_content["role"]   = appears_in_role
            await _relate_unique(db, e_rec, "appears_in", i_rec, edge_content or None)

    return {"id": str(e_rec), "slug": ent_slug}


# ─── Skill ────────────────────────────────────────────────────────────────


async def upsert_skill(
    *,
    slug: str,
    name: str,
    description: str,
    steps: Optional[list[str]] = None,
    frequency: Optional[str] = None,
    strength_increment: int = 1,
    tags: Optional[list[str]] = None,
    uses_integrations: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Add or strengthen a skill. ``strength_increment`` is *added* to existing strength."""
    slug = _slug(slug)
    s_rec = _rec("skill", slug)

    async with session() as db:
        # Check if it exists so we can choose CREATE vs UPDATE.
        existing = await db.query(
            "SELECT id, strength FROM skill WHERE id = $id LIMIT 1",
            {"id": s_rec},
        )
        rows = existing[0] if isinstance(existing, list) and existing else []
        rows = rows if isinstance(rows, list) else [rows]

        if rows:
            new_strength = int((rows[0] or {}).get("strength") or 1) + int(strength_increment)
            await db.query(
                """UPSERT $s MERGE {
                    name: $name, description: $desc, steps: $steps, frequency: $freq,
                    tags: $tags, strength: $strength, updated_at: time::now()
                }""",
                {
                    "s": s_rec, "name": name, "desc": description,
                    "steps": list(steps or []), "freq": frequency,
                    "tags": list(tags or []), "strength": new_strength,
                },
            )
            created = False
            strength = new_strength
        else:
            await db.query(
                """CREATE $s CONTENT {
                    name: $name, slug: $slug, description: $desc,
                    steps: $steps, frequency: $freq, strength: $strength, tags: $tags
                }""",
                {
                    "s": s_rec, "name": name, "slug": slug, "desc": description,
                    "steps": list(steps or []), "freq": frequency,
                    "strength": int(strength_increment), "tags": list(tags or []),
                },
            )
            created = True
            strength = int(strength_increment)

        for intg in uses_integrations or []:
            i_rec = _rec("integration", intg.strip().lower())
            await _relate_unique(db, s_rec, "skill_uses", i_rec)

    return {"id": str(s_rec), "slug": slug, "strength": strength, "created": created}


# ─── Workflow ─────────────────────────────────────────────────────────────


async def upsert_workflow(
    *,
    slug: str,
    name: str,
    description: str,
    trigger: Optional[str] = None,
    outcome: Optional[str] = None,
    frequency: Optional[str] = None,
    tags: Optional[list[str]] = None,
    skill_chain: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """Add-or-merge a workflow + replace its skill chain.

    ``skill_chain`` is a list of ``{"slug": str, "step_order": int}``.
    """
    slug = _slug(slug)
    w_rec = _rec("workflow", slug)

    async with session() as db:
        await db.query(
            """UPSERT $w MERGE {
                name: $name, slug: $slug, description: $desc,
                trigger: $trigger, outcome: $outcome,
                frequency: $freq, tags: $tags, updated_at: time::now()
            }""",
            {
                "w": w_rec, "name": name, "slug": slug, "desc": description,
                "trigger": trigger, "outcome": outcome,
                "freq": frequency, "tags": list(tags or []),
            },
        )

        # Replace the skill chain.
        if skill_chain is not None:
            await db.query(
                "DELETE workflow_contains_skill WHERE in = $w",
                {"w": w_rec},
            )
            for step in skill_chain:
                sk_rec = _rec("skill", _slug(str(step.get("slug") or "")))
                order = int(step.get("step_order") or 0)
                await db.query(
                    "RELATE $w->workflow_contains_skill->$s CONTENT { step_order: $o }",
                    {"w": w_rec, "s": sk_rec, "o": order},
                )

    return {"id": str(w_rec), "slug": slug}


# ─── Chat ─────────────────────────────────────────────────────────────────


async def add_chat(
    *,
    content: str,
    source_type: str,
    source_id: Optional[str] = None,
    title: Optional[str] = None,
    summary: Optional[str] = None,
    signal_level: str = "mid",
    occurred_at: Optional[str] = None,
    from_integration: Optional[str] = None,
    mentions: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """Persist a chat record. Dedup key is ``source_id`` if provided.

    ``mentions`` is a list of ``{"id": "entity:...", "mention_type": "author"|"author_of"|...}``.
    """
    content = content.strip()
    if not content:
        raise ValueError("content is required")

    chat_slug = source_id or _hash_id(content, source_type, prefix="agent_chat")
    c_rec = _rec("chat", chat_slug)

    occurred = None
    if occurred_at:
        try:
            occurred = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
        except ValueError:
            occurred = None

    async with session() as db:
        await db.query(
            """UPSERT $c MERGE {
                title: $title, content: $content, source_type: $stype,
                source_id: $sid, signal_level: $sig, summary: $summary,
                occurred_at: $occ
            }""",
            {
                "c": c_rec, "title": title, "content": content, "stype": source_type,
                "sid": source_id, "sig": signal_level, "summary": summary, "occ": occurred,
            },
        )
        if from_integration:
            i_rec = _rec("integration", from_integration.strip().lower())
            await _relate_unique(db, c_rec, "chat_from", i_rec)
        for mention in mentions or []:
            e_rec = _parse_record(mention.get("id", ""))
            if not e_rec:
                continue
            mtype = mention.get("mention_type") or "subject"
            await _relate_unique(db, c_rec, "chat_mentions", e_rec, {"mention_type": mtype})

    return {"id": str(c_rec)}


# ─── Wiki page ────────────────────────────────────────────────────────────


async def write_wiki_page(
    *,
    path: str,
    content: str,
    rationale: Optional[str] = None,
    written_by: str = "agent",
) -> dict[str, Any]:
    """Diff-update a wiki page; logs a revision when the content actually changes.

    Schema requires: ``layer`` ∈ {root, integrations, entities, chats, memories,
    skills, workflows}, ``depth`` ∈ {1, 2, 3}, ``token_budget`` > 0. We derive
    layer + depth from the path and pick a token_budget by depth.
    """
    path = path.strip()
    if not path:
        raise ValueError("path is required")

    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    token_budget_by_depth = {1: 4000, 2: 600, 3: 300}
    valid_layers = {"root", "integrations", "entities", "chats",
                    "memories", "skills", "workflows"}

    # Derive layer from the path's first segment.
    first_segment = path.split("/", 1)[0].split(".", 1)[0]
    layer = first_segment if first_segment in valid_layers else "root"

    # Schema bounds depth ∈ {1, 2, 3}.
    depth = max(1, min(3, path.count("/") + 1))

    async with session() as db:
        existing = await db.query(
            "SELECT id, content, revision FROM wiki_page WHERE path = $path LIMIT 1",
            {"path": path},
        )
        rows = existing[0] if isinstance(existing, list) and existing else []
        rows = rows if isinstance(rows, list) else [rows]

        if not rows:
            page_slug = _slug(path)
            p_rec = _rec("wiki_page", page_slug)
            await db.query(
                """CREATE $p CONTENT {
                    path:           $path,
                    content:        $content,
                    depth:          $depth,
                    layer:          $layer,
                    token_budget:   $tb,
                    content_hash:   $hash,
                    updated_by:     $by,
                    revision:       1
                }""",
                {"p": p_rec, "path": path, "content": content,
                 "depth": depth, "layer": layer,
                 "tb": token_budget_by_depth.get(depth, 600),
                 "hash": content_hash, "by": written_by},
            )
            new_revision = 1
            updated = True
            same = False
        else:
            row = rows[0] or {}
            p_rec = row.get("id")
            same = (row.get("content") or "") == content
            if not same:
                new_revision = int(row.get("revision") or 0) + 1
                await db.query(
                    """UPDATE $p SET
                        content = $content,
                        content_hash = $hash,
                        updated_at = time::now(),
                        updated_by = $by,
                        revision = $rev""",
                    {"p": p_rec, "content": content, "hash": content_hash,
                     "by": written_by, "rev": new_revision},
                )
            else:
                new_revision = int(row.get("revision") or 0)
            updated = not same

        # Log a revision row only when content actually changed.
        if updated:
            await db.query(
                """CREATE wiki_page_revision CONTENT {
                    page:           $p,
                    revision:       $rev,
                    content:        $content,
                    content_hash:   $hash,
                    written_by:     $by,
                    rationale:      $rationale
                }""",
                {"p": p_rec, "rev": new_revision, "content": content,
                 "hash": content_hash, "by": written_by, "rationale": rationale},
            )

    return {"id": str(p_rec), "path": path,
            "updated": updated, "unchanged": same, "revision": new_revision}


# ─── User profile ────────────────────────────────────────────────────────


async def update_user_profile(
    *,
    name: Optional[str] = None,
    role: Optional[str] = None,
    goals: Optional[list[str]] = None,
    preferences: Optional[dict] = None,
    context_window: Optional[int] = None,
) -> dict[str, Any]:
    """Patch the singleton ``user_profile:default`` record."""
    u_rec = _rec("user_profile", "default")
    fields: dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
    if name           is not None: fields["name"]           = name
    if role           is not None: fields["role"]           = role
    if goals          is not None: fields["goals"]          = list(goals)
    if preferences    is not None: fields["preferences"]    = preferences
    if context_window is not None: fields["context_window"] = int(context_window)

    if len(fields) == 1:  # only updated_at
        return {"id": str(u_rec), "updated": False, "reason": "no fields supplied"}

    async with session() as db:
        await db.query("UPSERT $u MERGE $payload", {"u": u_rec, "payload": fields})
    return {"id": str(u_rec), "updated": True, "fields": list(fields.keys())}
