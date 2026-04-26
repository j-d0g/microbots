"""Batch job: surface candidates from the current graph state.

Designed to be run by a daemon after each ingest cycle. Writes results to the
`automation_candidate` table with `kind` + `risk_tier` stored inside the
flexible `signal_axes` field so the schema stays loose. Re-running is safe —
existing candidates with the same deterministic ID are upserted.

Each detector is a small, independent function. Add or remove freely.

Usage:
    cd knowledge_graph && uv run python -m candidates.surface
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from dataclasses import dataclass, field
from typing import Any

from surrealdb import AsyncSurreal

log = logging.getLogger("candidates.surface")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


# ---------------------------------------------------------------------------
# Candidate dataclass — kept loose; emit whatever fields the detector wants.
# ---------------------------------------------------------------------------


@dataclass
class Candidate:
    kind: str            # 'enrichment' | 'hygiene' | 'bridge' | 'workflow_promotion' | 'tool_integration' | 'risk_flag' | 'automation' | 'question'
    risk_tier: int       # 1 (autonomous) → 4 (asks user)
    title: str
    story: str
    suggested_action: str
    evidence_chat_ids: list[str] = field(default_factory=list)
    evidence_entity_ids: list[str] = field(default_factory=list)
    evidence_memory_ids: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)  # anything else the detector wants

    def stable_id(self) -> str:
        """Deterministic ID so re-runs upsert instead of duplicating."""
        h = hashlib.sha1(f"{self.kind}:{self.title}".encode()).hexdigest()[:16]
        return f"automation_candidate:surfaced_{h}"


# ---------------------------------------------------------------------------
# Detectors — each returns a list of Candidates. Independent. Cheap queries.
# ---------------------------------------------------------------------------


async def detect_duplicate_entities(db: AsyncSurreal) -> list[Candidate]:
    """Tier 1 (enrichment): same name, different entity_type → likely duplicate."""
    rows = await db.query(
        "SELECT name, entity_type, id FROM entity ORDER BY name;"
    )
    by_name: dict[str, list[dict]] = {}
    for r in rows or []:
        by_name.setdefault(r["name"], []).append(r)
    out: list[Candidate] = []
    for name, group in by_name.items():
        if len(group) > 1:
            types = [g.get("entity_type") for g in group]
            ids = [str(g["id"]) for g in group]
            out.append(Candidate(
                kind="enrichment",
                risk_tier=1,
                title=f"Merge duplicate entity '{name}' ({len(group)} variants)",
                story=f"Entity '{name}' exists {len(group)}× with types {types}. Likely the same real-world thing.",
                suggested_action=f"Pick one canonical row, redirect edges, delete the others. Entities: {ids}",
                evidence_entity_ids=ids,
                extra={"duplicate_count": len(group), "types": types},
            ))
    return out


async def detect_orphan_entities(db: AsyncSurreal) -> list[Candidate]:
    """Tier 1 (hygiene): entities with 0 chat mentions and 0 related_to_entity edges."""
    rows = await db.query("""
        SELECT id, name, entity_type,
               count(<-chat_mentions) AS mentions,
               count(<-related_to_entity) + count(->related_to_entity) AS bridges
        FROM entity
        WHERE entity_type NOT IN ['user_self','demo-anchor'];
    """)
    out: list[Candidate] = []
    orphans = [r for r in (rows or []) if r.get("mentions", 0) == 0 and r.get("bridges", 0) == 0]
    if orphans:
        names = [r["name"] for r in orphans[:10]]
        out.append(Candidate(
            kind="hygiene",
            risk_tier=1,
            title=f"Archive {len(orphans)} orphan entities (0 mentions, 0 bridges)",
            story=f"These entities have no chat mentions and no relationships: {', '.join(names[:5])}{'...' if len(orphans) > 5 else ''}.",
            suggested_action="Move to an `archive` table or delete; they add noise to wiki rendering.",
            evidence_entity_ids=[str(r["id"]) for r in orphans],
            extra={"orphan_count": len(orphans)},
        ))
    return out


async def detect_recurring_skill_promotion(db: AsyncSurreal) -> list[Candidate]:
    """Tier 2 (workflow_promotion): a skill derived from ≥3 chats → propose saving as workflow."""
    rows = await db.query("""
        SELECT in.id AS skill_id, in.name AS skill_name, count() AS chat_count
        FROM skill_derived_from
        GROUP BY skill_id, skill_name
        ORDER BY chat_count DESC;
    """)
    out: list[Candidate] = []
    for r in rows or []:
        if r.get("chat_count", 0) >= 3:
            out.append(Candidate(
                kind="workflow_promotion",
                risk_tier=2,
                title=f"Promote '{r['skill_name']}' to a saved workflow",
                story=f"Skill '{r['skill_name']}' has been derived from {r['chat_count']} different chats. Recurring enough to skillify into a one-click workflow.",
                suggested_action=f"Define the parameters of '{r['skill_name']}' once, save as workflow, then offer it to the user the next time the trigger pattern is detected.",
                extra={"chat_count": r["chat_count"], "skill_id": str(r["skill_id"])},
            ))
    return out


async def detect_unused_authorizations(db: AsyncSurreal) -> list[Candidate]:
    """Tier 2 (risk_flag): authorized integrations with no follow-up usage in chats."""
    rows = await db.query("""
        SELECT title, id FROM chat
        WHERE string::lowercase(title ?? '') CONTAINS 'authoriz'
           OR string::lowercase(title ?? '') CONTAINS 'access to your account';
    """)
    out: list[Candidate] = []
    for r in rows or []:
        out.append(Candidate(
            kind="risk_flag",
            risk_tier=2,
            title="Review recent third-party authorization",
            story=f"You authorized a third-party app: '{r['title']}'. Worth confirming it's still needed.",
            suggested_action="Check usage in the last 14 days. If unused, revoke at the source (GitHub Settings → Applications, etc.).",
            evidence_chat_ids=[str(r["id"])],
        ))
    return out


async def detect_canceled_clusters(db: AsyncSurreal) -> list[Candidate]:
    """Tier 4 (question): clusters of canceled tasks → ask if scope changed."""
    rows = await db.query("""
        SELECT title, id FROM chat
        WHERE source_type = 'linear_issue'
          AND (string::lowercase(summary ?? '') CONTAINS 'cancel'
               OR string::lowercase(content ?? '') CONTAINS 'state.*cancel');
    """)
    out: list[Candidate] = []
    canceled = rows or []
    if len(canceled) >= 2:
        titles = [r["title"] for r in canceled]
        out.append(Candidate(
            kind="question",
            risk_tier=4,
            title=f"Confirm scope change: {len(canceled)} Linear issues canceled this period",
            story=f"Canceled tasks cluster suggests scope or priority change: {', '.join(titles)}.",
            suggested_action="Ask the user whether the underlying project goal has shifted, or if any of these should be re-opened in a different form.",
            evidence_chat_ids=[str(r["id"]) for r in canceled],
        ))
    return out


DETECTORS = [
    detect_duplicate_entities,
    detect_orphan_entities,
    detect_recurring_skill_promotion,
    detect_unused_authorizations,
    detect_canceled_clusters,
]


# ---------------------------------------------------------------------------
# Dashboard render — write all open candidates to a wiki page after each run.
# Hand-curated hero candidates (no signal_axes.kind) are listed first so the
# demo can lead with them; auto-surfaced ones group by tier underneath.
# ---------------------------------------------------------------------------


_TIER_LABELS = {
    1: "Tier 1 — Autonomous (low risk, high success)",
    2: "Tier 2 — Suggest-and-confirm (1-click)",
    3: "Tier 3 — Drafted action (user reviews + sends)",
    4: "Tier 4 — Open question (agent asks)",
}


async def render_dashboard(db: AsyncSurreal) -> None:
    rows = await db.query(
        "SELECT title, story, suggested_action, signal_axes, time_sensitive_until "
        "FROM automation_candidate WHERE status = 'open';"
    )
    rows = rows or []
    hero = [r for r in rows if not (r.get("signal_axes") or {}).get("kind")]
    auto = [r for r in rows if (r.get("signal_axes") or {}).get("kind")]
    auto.sort(key=lambda r: ((r.get("signal_axes") or {}).get("risk_tier", 9), r.get("title", "")))

    lines = ["# Automation Candidates", "", "> Parent: [user.md](user.md)", "",
             f"_{len(rows)} open candidates surfaced from the current graph state._", ""]

    if hero:
        lines += ["## Hero candidates (curated for demo)", ""]
        for r in hero:
            sa = r.get("signal_axes") or {}
            sig = (
                f"commercial={sa.get('commercial','?')} · "
                f"time_sensitivity={sa.get('time_sensitivity','?')} · "
                f"agent_actionability={sa.get('agent_actionability','?')} · "
                f"cross_tool={sa.get('cross_tool_density','?')}"
            )
            deadline = f"  ⏰ {r['time_sensitive_until']}" if r.get("time_sensitive_until") else ""
            lines += [
                f"### {r['title']}{deadline}",
                f"_Signal: {sig}_",
                "",
                r.get("story", ""),
                "",
                f"**Suggested action:** {r.get('suggested_action','')}",
                "",
                "---",
                "",
            ]

    if auto:
        lines += ["## Auto-surfaced (batch job output)", ""]
        last_tier = None
        for r in auto:
            sa = r.get("signal_axes") or {}
            tier = sa.get("risk_tier", 9)
            if tier != last_tier:
                lines += ["", f"### {_TIER_LABELS.get(tier, f'Tier {tier}')}", ""]
                last_tier = tier
            kind = sa.get("kind", "?")
            lines += [
                f"- **[{kind}]** {r['title']}",
                f"  - {r.get('story','')}",
                f"  - _Action:_ {r.get('suggested_action','')}",
            ]

    content = "\n".join(lines)
    # Replace existing dashboard
    await db.query("DELETE wiki_page WHERE path = 'automations.md';")
    await db.query(
        "CREATE wiki_page CONTENT $p;",
        {
            "p": {
                "path": "automations.md",
                "layer": "root",
                "depth": 1,
                "title": "Automation Candidates",
                "content": content,
                "token_budget": 4000,
                "updated_by": "candidates.surface",
            }
        },
    )
    log.info("Rendered dashboard: %d candidates → automations.md", len(rows))


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------


async def upsert_candidate(db: AsyncSurreal, c: Candidate) -> None:
    rid = c.stable_id()
    payload = {
        "title": c.title,
        "story": c.story,
        "suggested_action": c.suggested_action,
        "status": "open",
        "signal_axes": {
            "kind": c.kind,
            "risk_tier": c.risk_tier,
            **c.extra,
        },
    }
    # UPSERT-style: delete existing then create (Surreal v2 lacks clean upsert syntax)
    await db.query(f"DELETE {rid};")
    await db.query(f"CREATE {rid} CONTENT $p;", {"p": payload})

    # Wire evidence edges
    for cid in c.evidence_chat_ids:
        await db.query(f"RELATE {rid} -> candidate_evidence_chat -> {cid};")
    for eid in c.evidence_entity_ids:
        await db.query(f"RELATE {rid} -> candidate_evidence_entity -> {eid};")
    for mid in c.evidence_memory_ids:
        await db.query(f"RELATE {rid} -> candidate_evidence_memory -> {mid};")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main() -> None:
    url = os.environ.get("SURREAL_URL", "ws://localhost:8000/rpc")
    db = AsyncSurreal(url)
    await db.connect()
    await db.signin({"username": os.environ["SURREAL_USER"], "password": os.environ["SURREAL_PASS"]})
    await db.use(os.environ["SURREAL_NS"], os.environ["SURREAL_DB"])

    total = 0
    for det in DETECTORS:
        cands = await det(db)
        log.info("%s -> %d candidate(s)", det.__name__, len(cands))
        for c in cands:
            await upsert_candidate(db, c)
            total += 1
    log.info("Surfaced %d candidates total.", total)

    await render_dashboard(db)

    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
