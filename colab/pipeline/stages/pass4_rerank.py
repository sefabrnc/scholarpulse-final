"""Pass 4: reranker adjudication with confidence tier gate."""

from __future__ import annotations

from ..models.reranker import RerankerModel
from ..types import CiteEdge, PipelineContext


def _confidence_tier(ce_score: float, high_threshold: float, medium_threshold: float) -> str:
    if ce_score >= high_threshold:
        return "high"
    if ce_score >= medium_threshold:
        return "medium"
    return "low"


def _effective_ce_threshold(
    context: PipelineContext,
    item: dict,
    node_by_id: dict[str, object],
) -> float:
    if item.get("ref_index") is not None:
        return float(context.config.intra_paper_ce_threshold)
    target_id = str(item.get("target_id", ""))
    target_node = node_by_id.get(target_id)
    element_type = getattr(target_node, "element_type", None)
    if element_type == "reference":
        return float(context.config.intra_paper_ce_threshold)
    return float(context.config.ce_threshold)


def _is_intra_paper_candidate(
    context: PipelineContext,
    item: dict,
    node_by_id: dict[str, object],
) -> bool:
    if item.get("ref_index") is not None:
        return True
    target_id = str(item.get("target_id", ""))
    target_node = node_by_id.get(target_id)
    return getattr(target_node, "element_type", None) == "reference"


def _passes_rerank_gate(
    context: PipelineContext,
    item: dict,
    node_by_id: dict[str, object],
    ce_score: float,
) -> bool:
    threshold = _effective_ce_threshold(context, item, node_by_id)
    if not _is_intra_paper_candidate(context, item, node_by_id):
        return ce_score >= threshold
    vector_score = float(item.get("vector_score", 0.0))
    vector_floor = float(context.config.vector_score_threshold)
    # Marker-validated intra-paper pairs: keep when retrieval or CE clears configured floors.
    return ce_score >= threshold or vector_score >= vector_floor


def run(context: PipelineContext, reranker: RerankerModel) -> PipelineContext:
    if context.skipped_reason:
        return context

    candidates = context.artifacts.get("candidates", [])
    node_by_id = {node.sentence_id: node for node in context.nodes}
    pairs = [(item["source_text"], item["target_text"]) for item in candidates]
    scores = reranker.score_pairs(pairs) if pairs else []

    edges = []
    dropped = 0
    dropped_intra = 0
    dropped_general = 0
    kept_via_vector_floor = 0
    for item, ce_score in zip(candidates, scores):
        threshold = _effective_ce_threshold(context, item, node_by_id)
        intra = _is_intra_paper_candidate(context, item, node_by_id)
        if not _passes_rerank_gate(context, item, node_by_id, ce_score):
            dropped += 1
            if intra:
                dropped_intra += 1
            else:
                dropped_general += 1
            continue
        if intra and ce_score < threshold and float(item.get("vector_score", 0.0)) >= float(
            context.config.vector_score_threshold
        ):
            kept_via_vector_floor += 1
        tier = _confidence_tier(
            ce_score,
            context.config.high_confidence_threshold,
            threshold,
        )
        edges.append(
            CiteEdge(
                source_id=item["source_id"],
                target_id=item["target_id"],
                vector_score=float(item.get("vector_score", 0.0)),
                ce_score=float(ce_score),
                ref_index=item.get("ref_index"),
                confidence_tier=tier,
            )
        )
    context.edges = edges
    score_values = [float(value) for value in scores]
    context.artifacts["rerank_stats"] = {
        "candidate_count": len(candidates),
        "edge_count": len(edges),
        "dropped_below_threshold": dropped,
        "dropped_intra_paper": dropped_intra,
        "dropped_general": dropped_general,
        "kept_via_vector_floor": kept_via_vector_floor,
        "ce_threshold": context.config.ce_threshold,
        "intra_paper_ce_threshold": context.config.intra_paper_ce_threshold,
        "vector_score_threshold": context.config.vector_score_threshold,
        "ce_score_min": min(score_values) if score_values else None,
        "ce_score_max": max(score_values) if score_values else None,
        "ce_score_mean": round(sum(score_values) / len(score_values), 6) if score_values else None,
        "reranker_backend": reranker.backend,
    }
    return context
