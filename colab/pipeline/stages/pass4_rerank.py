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


def run(context: PipelineContext, reranker: RerankerModel) -> PipelineContext:
    if context.skipped_reason:
        return context

    candidates = context.artifacts.get("candidates", [])
    pairs = [(item["source_text"], item["target_text"]) for item in candidates]
    scores = reranker.score_pairs(pairs) if pairs else []

    edges = []
    dropped = 0
    for item, ce_score in zip(candidates, scores):
        if ce_score < context.config.ce_threshold:
            dropped += 1
            continue
        tier = _confidence_tier(
            ce_score,
            context.config.high_confidence_threshold,
            context.config.ce_threshold,
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
    context.artifacts["rerank_stats"] = {
        "candidate_count": len(candidates),
        "edge_count": len(edges),
        "dropped_below_threshold": dropped,
        "ce_threshold": context.config.ce_threshold,
    }
    return context
