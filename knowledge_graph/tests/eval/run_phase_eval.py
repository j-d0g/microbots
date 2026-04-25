"""Single Devin-invokable entrypoint for eval pipeline.

Orchestrates: DB reset → ingest fixtures → dump phase output → structural checks
→ graph QA → wiki QA bundle. All steps are idempotent with no interactive prompts.

Usage:
    uv run python knowledge_graph/tests/eval/run_phase_eval.py \
        --phase <phase> --label <baseline|candidate> --split <train|holdout>

Phases: triage, memory_extraction, entity_resolution, skill_detection,
        workflow_composition, wiki, all
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "python-dotenv>=1", "pyyaml>=6"]
# ///
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent  # = knowledge_graph/
REPO_ROOT = ROOT.parent
FIXTURES = ROOT / "tests" / "fixtures"
REPORTS_DIR = Path(__file__).parent / "reports"
REPORTS_DIR.mkdir(exist_ok=True)

ALL_PHASES = [
    "triage", "memory_extraction", "entity_resolution",
    "skill_detection", "workflow_composition", "wiki",
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(name)s — %(message)s")
log = logging.getLogger("run_phase_eval")


# ---------------------------------------------------------------------------
# Step 1: DB reset (docker compose down -v && up -d + schema)
# ---------------------------------------------------------------------------

def reset_db() -> None:
    """Reset SurrealDB: down -v, up -d, apply schema."""
    log.info("Step 1: Resetting SurrealDB ...")
    compose_file = REPO_ROOT / "docker-compose.yml"
    cwd = str(REPO_ROOT)

    subprocess.run(
        ["docker", "compose", "down", "-v"],
        cwd=cwd, capture_output=True, text=True, check=False,
    )
    result = subprocess.run(
        ["docker", "compose", "up", "-d"],
        cwd=cwd, capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        log.error("docker compose up failed: %s", result.stderr)
        raise RuntimeError("Failed to start SurrealDB")

    # Wait for health
    import time
    for attempt in range(30):
        health = subprocess.run(
            ["curl", "-sf", "http://localhost:8000/health"],
            capture_output=True, text=True, check=False,
        )
        if health.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError("SurrealDB did not become healthy in 30s")

    log.info("SurrealDB is up. Applying schema ...")
    subprocess.run(
        ["uv", "run", "python", str(ROOT / "schema" / "apply.py")],
        cwd=str(ROOT), check=True,
    )
    log.info("Schema applied.")


# ---------------------------------------------------------------------------
# Step 2: Ingest fixtures
# ---------------------------------------------------------------------------

async def ingest_fixtures(split: str) -> None:
    """Run fixture ingest for the given split."""
    log.info("Step 2: Ingesting fixtures (split=%s) ...", split)
    sys.path.insert(0, str(ROOT))

    from tests.eval.run_ingest_fixture import main as ingest_main

    # Patch the FIXTURES_TRAIN path for the chosen split
    import tests.eval.run_ingest_fixture as rif
    original_dir = rif.FIXTURES_TRAIN
    rif.FIXTURES_TRAIN = FIXTURES / split
    try:
        await ingest_main()
    finally:
        rif.FIXTURES_TRAIN = original_dir

    log.info("Fixture ingest complete.")


# ---------------------------------------------------------------------------
# Step 3: Dump phase output
# ---------------------------------------------------------------------------

async def dump_phase_output(phase: str, label: str, split: str) -> Path:
    """Query DB and dump the phase-relevant tables as JSON."""
    log.info("Step 3: Dumping phase output for %s ...", phase)
    sys.path.insert(0, str(ROOT))
    from config import load_config
    from db.client import microbots_session

    config = load_config()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    phase_tables = {
        "triage": ["chat"],
        "memory_extraction": ["memory"],
        "entity_resolution": ["entity"],
        "skill_detection": ["skill"],
        "workflow_composition": ["workflow"],
        "wiki": ["wiki_page"],
        "all": ["chat", "memory", "entity", "skill", "workflow"],
    }
    tables = phase_tables.get(phase, ["chat", "memory", "entity", "skill", "workflow"])

    output: dict[str, list[dict]] = {}
    async with microbots_session(config) as mdb:
        for table in tables:
            try:
                rows = await mdb.raw_query(f"SELECT * FROM {table}")
                # Convert to JSON-serializable format
                clean_rows = json.loads(json.dumps(rows, default=str))
                output[table] = clean_rows
            except Exception as e:
                log.warning("Failed to query table %s: %s", table, e)
                output[table] = []

    fname = f"phase_output_{phase}_{label}_{split}_{ts}.json"
    out_path = REPORTS_DIR / fname
    out_path.write_text(json.dumps(output, indent=2, default=str), encoding="utf-8")
    log.info("Phase output written to %s", out_path)
    return out_path


# ---------------------------------------------------------------------------
# Step 4: Structural checks
# ---------------------------------------------------------------------------

async def run_structural(phase: str, label: str, split: str) -> Path:
    """Run structural.py checks and write scorecard."""
    log.info("Step 4: Running structural checks ...")
    sys.path.insert(0, str(ROOT))
    from config import load_config
    from db.client import microbots_session
    from tests.eval.structural import run_structural_checks, write_scorecard

    config = load_config()
    corpus_meta = json.loads((FIXTURES / "corpus_meta.json").read_text())
    memory_dir = ROOT / "memory"

    async with microbots_session(config) as mdb:
        db_entities = await mdb.raw_query("SELECT * FROM entity")
        db_memories = await mdb.raw_query("SELECT * FROM memory")
        db_skills = await mdb.raw_query("SELECT * FROM skill")
        db_workflows = await mdb.raw_query("SELECT * FROM workflow")

    scorecard = run_structural_checks(
        db_entities=db_entities,
        db_memories=db_memories,
        db_skills=db_skills,
        db_workflows=db_workflows,
        corpus_meta=corpus_meta,
        memory_dir=memory_dir,
        phase=phase,
        label=label,
        split=split,
    )
    out = write_scorecard(scorecard)
    log.info("Structural scorecard: %s", out)
    return out


# ---------------------------------------------------------------------------
# Step 5: Graph QA
# ---------------------------------------------------------------------------

async def run_graph_qa(label: str, split: str) -> Path:
    """Run graph-mode retrieval QA."""
    log.info("Step 5: Running graph-mode QA ...")
    sys.path.insert(0, str(ROOT))
    from tests.eval.retrieval_qa import run_graph_mode, write_graph_scorecard

    scorecard = await run_graph_mode(label, split)
    out = write_graph_scorecard(scorecard)
    log.info("Graph QA scorecard: %s", out)
    return out


# ---------------------------------------------------------------------------
# Step 6: Wiki QA bundle
# ---------------------------------------------------------------------------

def run_wiki_qa_bundle(label: str, split: str) -> Path:
    """Assemble wiki QA inputs for Devin."""
    log.info("Step 6: Assembling wiki QA bundle ...")
    sys.path.insert(0, str(ROOT))
    from tests.eval.retrieval_qa import run_wiki_bundle, write_wiki_bundle

    bundle = run_wiki_bundle(label, split)
    out = write_wiki_bundle(bundle)
    log.info("Wiki QA bundle: %s", out)
    return out


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

async def run_eval(phase: str, label: str, split: str, skip_reset: bool = False) -> dict:
    """Run the full eval pipeline. Returns manifest of artifact paths."""
    if not skip_reset:
        reset_db()

    await ingest_fixtures(split)
    phase_output_path = await dump_phase_output(phase, label, split)
    structural_path = await run_structural(phase, label, split)
    graph_qa_path = await run_graph_qa(label, split)
    wiki_qa_path = run_wiki_qa_bundle(label, split)

    manifest = {
        "phase": phase,
        "label": label,
        "split": split,
        "artifacts": {
            "phase_output": str(phase_output_path),
            "structural": str(structural_path),
            "qa_graph": str(graph_qa_path),
            "qa_wiki_inputs": str(wiki_qa_path),
        },
    }

    # Print manifest
    print("\n" + "=" * 60)
    print("EVAL MANIFEST")
    print("=" * 60)
    for key, path in manifest["artifacts"].items():
        print(f"  {key}: {path}")
    print("=" * 60 + "\n")

    # Write manifest
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    manifest_path = REPORTS_DIR / f"manifest_{phase}_{label}_{split}_{ts}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", default="triage", choices=ALL_PHASES + ["all"])
    parser.add_argument("--label", default="baseline", choices=["baseline", "candidate"])
    parser.add_argument("--split", default="train", choices=["train", "holdout"])
    parser.add_argument("--skip-reset", action="store_true",
                        help="Skip DB reset (use existing DB state)")
    args = parser.parse_args()

    asyncio.run(run_eval(args.phase, args.label, args.split, args.skip_reset))
