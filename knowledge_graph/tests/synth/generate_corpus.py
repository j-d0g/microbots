"""Synthetic corpus generator for the microbots test suite.

Generates a realistic 4-week corpus of integration payloads matching the seeded persona.
Writes deterministic JSON fixtures under tests/fixtures/{train,holdout}/.

Usage:
    uv run python tests/synth/generate_corpus.py [--model MODEL] [--seed SEED]
    # or:
    make synth-corpus
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "python-dotenv>=1", "anthropic>=0.97", "httpx>=0.28", "pyyaml>=6"]
# ///
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent  # = knowledge_graph/
FIXTURES = ROOT / "tests" / "fixtures"
SYNTH_DIR = ROOT / "tests" / "synth"
PERSONA_FILE = SYNTH_DIR / "persona.yaml"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("generate_corpus")


def _week_start(week_offset: int, base: datetime) -> datetime:
    return base + timedelta(weeks=week_offset)


def _ts(dt: datetime) -> str:
    return dt.isoformat()


def _slug(text: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40]


def _hash_id(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Deterministic fixture builders (no LLM for the structural skeleton)
# ---------------------------------------------------------------------------

def build_slack_messages(persona: dict, week: int, base_dt: datetime, rng: random.Random) -> list[dict]:
    """Generate realistic Slack thread payloads for a given week."""
    team = persona["team"]
    channels = persona["slack_channels"]
    conventions = persona["conventions"]

    templates = [
        {
            "channel": "#ai-engineering",
            "thread_id": f"slack-{week}-ai-eng-{_hash_id('ai-eng', str(week))}",
            "title": f"Week {week}: microbots SurrealDB progress",
            "messages": [
                {"author": "Desmond", "text": f"Pushed schema updates for week {week}. HNSW indexes are looking good."},
                {"author": team[1]["name"], "text": "Nice! Did you verify the embedding DIMENSION matches?"},
                {"author": "Desmond", "text": "Yes, 1536 — matches the OpenAI embeddings. All green."},
            ],
            "signal_level": "high",
        },
        {
            "channel": "#deployments",
            "thread_id": f"slack-{week}-deploy-{_hash_id('deploy', str(week))}",
            "title": f"Deploy: microbots v0.{week} to staging",
            "messages": [
                {"author": "Desmond", "text": f"Deploying microbots v0.{week} to staging now. Linear: MIC-{week*10}."},
                {"author": team[0]["name"], "text": "Looks good from infra side. Green light."},
                {"author": "Desmond", "text": "Deployed. All smoke tests passing."},
            ],
            "signal_level": "high",
        },
        {
            "channel": "#code-review",
            "thread_id": f"slack-{week}-cr-{_hash_id('cr', str(week))}",
            "title": f"PR review request: week {week} changes",
            "messages": [
                {"author": "Desmond", "text": f"@bob PR #{week*5} is ready for review — microbots enrichment layer."},
                {"author": team[1]["name"], "text": "On it. Will review today."},
            ],
            "signal_level": "mid",
        },
    ]

    items = rng.sample(templates, min(persona["items_per_week"]["slack"] // 3, len(templates)))
    result = []
    for i, t in enumerate(items):
        dt = _week_start(week - 1, base_dt) + timedelta(days=rng.randint(0, 6), hours=rng.randint(9, 18))
        result.append({
            "source_id": t["thread_id"],
            "source_type": "slack_thread",
            "title": t["title"],
            "content": "\n".join(f"{m['author']}: {m['text']}" for m in t["messages"]),
            "channel": t["channel"],
            "signal_level": t["signal_level"],
            "occurred_at": _ts(dt),
        })
    return result


def build_github_items(persona: dict, week: int, base_dt: datetime, rng: random.Random) -> list[dict]:
    repos = [r["slug"] for r in persona["repos"]]
    team = persona["team"]

    items = []
    for i in range(persona["items_per_week"]["github"]):
        pr_num = week * 10 + i
        repo = rng.choice(repos)
        dt = _week_start(week - 1, base_dt) + timedelta(days=rng.randint(0, 6))
        reviewer = rng.choice([team[0]["name"], team[1]["name"]])

        items.append({
            "source_id": f"pr-{repo}-{pr_num}",
            "source_type": "github_pr",
            "title": f"PR #{pr_num}: Feature update for {repo} (week {week})",
            "content": (
                f"{reviewer}: LGTM overall. A few nits:\n"
                f"1. Add type hints to the new functions.\n"
                f"2. Link the Linear ticket in the description.\n"
                f"Desmond: Good points, updated. Ready to merge.\n"
                f"{reviewer}: Merged."
            ),
            "signal_level": "high" if rng.random() > 0.3 else "mid",
            "occurred_at": _ts(dt),
        })
    return items


def build_linear_items(persona: dict, week: int, base_dt: datetime, rng: random.Random) -> list[dict]:
    projects = persona["linear_projects"]
    team = persona["team"]

    items = []
    for i in range(persona["items_per_week"]["linear"]):
        ticket_num = week * 5 + i
        project = rng.choice(projects)
        dt = _week_start(week - 1, base_dt) + timedelta(days=rng.randint(0, 6))
        assignee = rng.choice([team[member]["name"] for member in [0, 1, 2]])

        items.append({
            "source_id": f"linear-{ticket_num}",
            "source_type": "linear_ticket",
            "title": f"MIC-{ticket_num}: {project['name']} task (week {week})",
            "content": (
                f"Project: {project['name']}\n"
                f"Assignee: {assignee}\n"
                f"Status: In Progress → Done\n"
                f"Description: Week {week} implementation task. "
                f"PR linked: #{ticket_num * 2}."
            ),
            "signal_level": "curated",
            "occurred_at": _ts(dt),
        })
    return items


def build_gmail_items(persona: dict, week: int, base_dt: datetime, rng: random.Random) -> list[dict]:
    items = []
    templates = [
        ("Vendor update: AWS usage report", "vendor", "AWS sent the monthly usage report. Compute costs up 12% due to SurrealDB instances."),
        ("Investor update request", "investor", "Investor relations: please send the monthly update by end of week."),
        ("Contract renewal: Anthropic API", "vendor", "Anthropic API contract up for renewal. Negotiated 15% discount for annual plan."),
    ]
    for j in range(persona["items_per_week"]["gmail"]):
        tpl = rng.choice(templates)
        dt = _week_start(week - 1, base_dt) + timedelta(days=rng.randint(0, 6))
        items.append({
            "source_id": f"gmail-{week}-{j}",
            "source_type": "gmail_thread",
            "title": f"Week {week}: {tpl[0]}",
            "content": tpl[2],
            "signal_level": "mid",
            "occurred_at": _ts(dt),
        })
    return items


def build_notion_items(persona: dict, week: int, base_dt: datetime, rng: random.Random) -> list[dict]:
    templates = [
        ("Architecture Decision Record", "ADR: Use SurrealDB for agent memory graph. Decision: SurrealDB chosen for multi-model (graph+doc+vector) capability."),
        ("Meeting Notes", "Weekly sync notes: discussed microbots progress, deploy runbook update, and next sprint priorities."),
        ("Deploy Runbook", "Updated deploy runbook with smoke test step and Alice approval gate for infra-touching deploys."),
    ]
    items = []
    for j in range(persona["items_per_week"]["notion"]):
        tpl = rng.choice(templates)
        dt = _week_start(week - 1, base_dt) + timedelta(days=rng.randint(0, 6))
        items.append({
            "source_id": f"notion-{week}-{j}",
            "source_type": "notion_page",
            "title": f"Week {week}: {tpl[0]}",
            "content": tpl[1],
            "signal_level": "high" if j == 0 else "mid",
            "occurred_at": _ts(dt),
        })
    return items


def build_perplexity_items(persona: dict, week: int, base_dt: datetime, rng: random.Random) -> list[dict]:
    topics = [
        ("HNSW index tuning for SurrealDB", "Research: HNSW M=16, ef_construction=200 recommended for 1M vectors. SurrealDB DIMENSION must match embedding model output."),
        ("Pydantic AI vs LangChain tradeoffs", "Pydantic AI: typed structured output, provider-agnostic. LangChain: more ecosystem but heavier. Chose Pydantic AI for agent layer."),
        ("SurrealDB graph query patterns", "Best practices for SurrealDB graph traversal: use RELATE, arrow notation, and SELECT * FROM table WHERE <-relation<-other."),
    ]
    items = []
    for j in range(persona["items_per_week"]["perplexity"]):
        topic = rng.choice(topics)
        dt = _week_start(week - 1, base_dt) + timedelta(days=rng.randint(0, 6))
        items.append({
            "source_id": f"perplexity-{week}-{j}",
            "source_type": "perplexity_async",
            "title": f"Week {week}: Sonar research: {topic[0]}",
            "content": topic[1],
            "signal_level": "high",
            "occurred_at": _ts(dt),
        })
    return items


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate(seed: int = 42, split: float = 0.75) -> None:
    rng = random.Random(seed)
    raw = yaml.safe_load(PERSONA_FILE.read_text())
    # Support both flat format and nested {persona: ...} format
    persona = raw.get("persona", raw) if isinstance(raw, dict) and "team" not in raw else raw
    # Merge top-level keys into persona dict
    for k in ("team", "repos", "linear_projects", "slack_channels", "conventions",
              "weeks", "items_per_week", "expected_entities", "expected_skills", "expected_workflows"):
        if k in raw and k not in persona:
            persona[k] = raw[k]
    base_dt = datetime(2025, 1, 6, tzinfo=timezone.utc)  # week 1 start
    weeks = persona.get("weeks", 4)

    all_items: dict[str, list[dict]] = {
        "slack": [],
        "github": [],
        "linear": [],
        "gmail": [],
        "notion": [],
        "perplexity": [],
    }

    for week in range(1, weeks + 1):
        all_items["slack"].extend(build_slack_messages(persona, week, base_dt, rng))
        all_items["github"].extend(build_github_items(persona, week, base_dt, rng))
        all_items["linear"].extend(build_linear_items(persona, week, base_dt, rng))
        all_items["gmail"].extend(build_gmail_items(persona, week, base_dt, rng))
        all_items["notion"].extend(build_notion_items(persona, week, base_dt, rng))
        all_items["perplexity"].extend(build_perplexity_items(persona, week, base_dt, rng))

    log.info("Generated corpus: %s", {k: len(v) for k, v in all_items.items()})

    # Split into train / holdout
    train: dict[str, list[dict]] = {}
    holdout: dict[str, list[dict]] = {}
    for intg, items in all_items.items():
        rng.shuffle(items)
        cut = int(len(items) * split)
        train[intg] = items[:cut]
        holdout[intg] = items[cut:]

    # Write fixtures
    for split_name, data in [("train", train), ("holdout", holdout)]:
        split_dir = FIXTURES / split_name
        split_dir.mkdir(parents=True, exist_ok=True)
        for intg, items in data.items():
            out = split_dir / f"{intg}.json"
            out.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")
            log.info("Wrote %s (%d items)", out, len(items))

    # corpus_meta.json with ground-truth annotations
    corpus_meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": seed,
        "persona": persona.get("persona", {}),
        "total_items": {k: len(v) for k, v in all_items.items()},
        "expected_entities": persona.get("expected_entities", []),
        "expected_skills": persona.get("expected_skills", []),
        "expected_workflows": persona.get("expected_workflows", []),
    }
    meta_path = FIXTURES / "corpus_meta.json"
    meta_path.write_text(json.dumps(corpus_meta, indent=2), encoding="utf-8")
    log.info("Wrote corpus_meta.json")

    log.info("Done. Fixtures under %s", FIXTURES)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--split", type=float, default=0.75, help="Train split fraction")
    args = parser.parse_args()
    generate(seed=args.seed, split=args.split)
