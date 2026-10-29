"""Deterministic promotion checks retained for regression tests; no git side effects."""
from __future__ import annotations

EPSILON_TRAIN = 0.05
EPSILON_HOLDOUT = 0.02
TIE_BAND = 0.05
QA_REGRESSION_THRESHOLD = 0.05
STRUCTURAL_REGRESSION_THRESHOLD = 0.05


HARD_FLOORS: dict[str, tuple[str, float]] = {
    "entity_precision":          (">=", 0.95),
    "memory_hallucination_rate": ("==", 0.0),
    "negative_suppression":      (">=", 0.95),
    "workflow_precision":        ("==", 1.0),
    "wiki_hallucination_rate":   ("==", 0.0),
}


def check_hard_floors(structural: dict) -> list[str]:
    """Return list of hard floor violations."""
    violations = []
    metrics = structural.get("structural", {})
    for metric, (op, threshold) in HARD_FLOORS.items():
        value = metrics.get(metric)
        if value is None:
            continue
        if op == ">=" and value < threshold:
            violations.append(f"{metric}={value} < {threshold}")
        elif op == "==" and value != threshold:
            violations.append(f"{metric}={value} != {threshold}")
    return violations


# ---------------------------------------------------------------------------
# Promotion rule (all deterministic, no LLM)
# ---------------------------------------------------------------------------

def evaluate_promotion(
    phase: str,
    baseline_rubric_train: dict,
    candidate_rubric_train: dict,
    baseline_rubric_holdout: dict,
    candidate_rubric_holdout: dict,
    baseline_structural: dict,
    candidate_structural: dict,
    baseline_qa_graph: dict,
    candidate_qa_graph: dict,
    baseline_qa_wiki: dict,
    candidate_qa_wiki: dict,
) -> tuple[bool, list[str]]:
    """Apply promotion rule. Returns (promote, rejection_reasons)."""
    reasons: list[str] = []

    # Rule 1: rubric_median(candidate, train) >= rubric_median(baseline, train) + 0.05
    bt = float(baseline_rubric_train.get("weighted_total", 0))
    ct = float(candidate_rubric_train.get("weighted_total", 0))
    if ct < bt + EPSILON_TRAIN:
        reasons.append(f"Rule 1: train rubric {ct:.3f} < baseline {bt:.3f} + {EPSILON_TRAIN}")

    # Tie band: |candidate - baseline| <= 0.05 → reject as tie
    if abs(ct - bt) <= TIE_BAND:
        reasons.append(f"Tie band: |{ct:.3f} - {bt:.3f}| = {abs(ct-bt):.3f} <= {TIE_BAND}")

    # Rule 2: rubric_median(candidate, holdout) >= rubric_median(baseline, holdout) + 0.02
    bh = float(baseline_rubric_holdout.get("weighted_total", 0))
    ch = float(candidate_rubric_holdout.get("weighted_total", 0))
    if bh > 0 and ch < bh + EPSILON_HOLDOUT:
        reasons.append(f"Rule 2: holdout rubric {ch:.3f} < baseline {bh:.3f} + {EPSILON_HOLDOUT}")

    # Rule 3 + 4: QA graph — no regression, no per-target drop > 0.05
    bqg = float(baseline_qa_graph.get("qa_graph_total", 0))
    cqg = float(candidate_qa_graph.get("qa_graph_total", 0))
    if bqg > 0 and cqg < bqg:
        reasons.append(f"Rule 3: qa_graph_total regression {cqg:.3f} < {bqg:.3f}")

    b_graph_targets = baseline_qa_graph.get("per_target_means", {})
    c_graph_targets = candidate_qa_graph.get("per_target_means", {})
    for target in b_graph_targets:
        bv = float(b_graph_targets.get(target, 0))
        cv = float(c_graph_targets.get(target, 0))
        if bv > 0 and bv - cv > QA_REGRESSION_THRESHOLD:
            reasons.append(f"Rule 4: qa_graph target '{target}' regression {cv:.3f} < {bv:.3f} - {QA_REGRESSION_THRESHOLD}")

    # QA wiki — same checks
    bqw = float(baseline_qa_wiki.get("qa_wiki_total", 0))
    cqw = float(candidate_qa_wiki.get("qa_wiki_total", 0))
    if bqw > 0 and cqw < bqw:
        reasons.append(f"Rule 3: qa_wiki_total regression {cqw:.3f} < {bqw:.3f}")

    b_wiki_targets = baseline_qa_wiki.get("per_target_means", {})
    c_wiki_targets = candidate_qa_wiki.get("per_target_means", {})
    for target in b_wiki_targets:
        bv = float(b_wiki_targets.get(target, 0))
        cv = float(c_wiki_targets.get(target, 0))
        if bv > 0 and bv - cv > QA_REGRESSION_THRESHOLD:
            reasons.append(f"Rule 4: qa_wiki target '{target}' regression {cv:.3f} < {bv:.3f} - {QA_REGRESSION_THRESHOLD}")

    # Rule 5: Hard floors on candidate
    floor_violations = check_hard_floors(candidate_structural)
    if floor_violations:
        reasons.extend(f"Rule 5 (hard floor): {v}" for v in floor_violations)

    # Rule 6: No structural recall metric drops by more than 0.05
    recall_metrics = ["entity_recall", "entity_alias_coverage", "skill_recall", "workflow_recall"]
    b_struct = baseline_structural.get("structural", {})
    c_struct = candidate_structural.get("structural", {})
    for m in recall_metrics:
        bv = float(b_struct.get(m, 0))
        cv = float(c_struct.get(m, 0))
        if bv > 0 and bv - cv > STRUCTURAL_REGRESSION_THRESHOLD:
            reasons.append(f"Rule 6: structural '{m}' regression {cv:.3f} < {bv:.3f} - {STRUCTURAL_REGRESSION_THRESHOLD}")

    return (len(reasons) == 0, reasons)
