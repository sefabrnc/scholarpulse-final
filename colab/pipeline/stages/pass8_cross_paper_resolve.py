"""Pass 8: resolve incoming cross-paper citations onto real target sentences."""

from __future__ import annotations

import time
from typing import Dict, List, Sequence

from ..cross_citations import IncomingCrossCitation, dedupe_incoming
from ..index.faiss_local import DoiVectorIndexRegistry
from ..models.embedding import EmbeddingModel
from ..models.intent import IntentModel
from ..models.reranker import RerankerModel
from ..types import CiteEdge, PipelineContext, SentenceNode
from .pass4_rerank import _confidence_tier


def _target_sentence_nodes(context: PipelineContext) -> List[SentenceNode]:
    target_doi = context.paper.doi
    return [
        node
        for node in context.nodes
        if node.doi == target_doi and node.element_type == "sentence" and node.text.strip()
    ]


def run(
    context: PipelineContext,
    incoming: Sequence[IncomingCrossCitation],
    *,
    embedding_model: EmbeddingModel,
    reranker: RerankerModel,
    intent_model: IntentModel,
) -> PipelineContext:
    if context.skipped_reason:
        return context

    target_nodes = _target_sentence_nodes(context)
    node_embeddings = context.artifacts.get("node_embeddings", {})
    if not target_nodes or not isinstance(node_embeddings, dict):
        context.artifacts["cross_paper_stats"] = {
            "incoming": len(incoming),
            "resolved_edges": 0,
            "superseded_edges": 0,
            "reason": "missing_target_sentences_or_embeddings",
        }
        return context

    deduped = dedupe_incoming(incoming)
    if not deduped:
        context.artifacts["cross_paper_stats"] = {"incoming": 0, "resolved_edges": 0, "superseded_edges": 0}
        return context

    nodes_by_doi: Dict[str, List[str]] = {}
    node_by_id: Dict[str, SentenceNode] = {}
    for node in target_nodes:
        nodes_by_doi.setdefault(node.doi, []).append(node.sentence_id)
        node_by_id[node.sentence_id] = node

    registry = DoiVectorIndexRegistry()
    registry.build_from_embeddings(nodes_by_doi, node_embeddings)

    source_texts = [item.source_text for item in deduped]
    source_vectors = embedding_model.embed(source_texts) if source_texts else []

    candidates: List[Dict[str, object]] = []
    for item, source_vector in zip(deduped, source_vectors):
        hits = registry.search(
            context.paper.doi,
            source_vector,
            top_k=max(1, context.config.candidate_top_k),
            min_score=float(context.config.vector_score_threshold),
        )
        for target_id, score in hits:
            target_node = node_by_id.get(target_id)
            if not target_node:
                continue
            candidates.append(
                {
                    "incoming": item,
                    "source_id": item.source_id,
                    "target_id": target_id,
                    "source_text": item.source_text,
                    "target_text": target_node.text,
                    "vector_score": float(score),
                    "ref_index": item.ref_index,
                }
            )

    pairs = [(row["source_text"], row["target_text"]) for row in candidates]
    ce_scores = reranker.score_pairs(pairs) if pairs else []

    resolved_edges: List[CiteEdge] = []
    superseded: List[Dict[str, object]] = []
    source_stubs: Dict[str, Dict[str, str]] = {}
    now_ts = int(time.time())
    dropped = 0
    ce_floor = float(context.config.cross_paper_ce_threshold)

    for row, ce_score in zip(candidates, ce_scores):
        if ce_score < ce_floor:
            dropped += 1
            continue
        incoming_item: IncomingCrossCitation = row["incoming"]  # type: ignore[assignment]
        relation_type, intent_confidence = intent_model.predict(
            str(row["source_text"]),
            str(row["target_text"]),
        )
        tier = _confidence_tier(
            float(ce_score),
            context.config.high_confidence_threshold,
            ce_floor,
        )
        source_id = str(row["source_id"])
        resolved_edges.append(
            CiteEdge(
                source_id=source_id,
                target_id=str(row["target_id"]),
                vector_score=float(row["vector_score"]),
                ce_score=float(ce_score),
                ref_index=row.get("ref_index") if isinstance(row.get("ref_index"), int) else incoming_item.ref_index,
                relation_type=relation_type or "mentions",
                intent_confidence=float(round(intent_confidence, 6)),
                confidence_tier=tier,
            )
        )
        source_stubs[source_id] = {
            "source_id": source_id,
            "source_doi": incoming_item.source_doi or "",
            "source_text": incoming_item.source_text,
        }
        superseded.append(
            {
                "id": incoming_item.edge_id,
                "status": "superseded",
                "algorithm_version": context.artifacts.get("model_backends", {}).get(
                    "algorithm_version",
                    context.config.default_algorithm_version,
                ),
                "confidence_tier": tier,
                "last_validated_at": now_ts,
            }
        )

    if resolved_edges:
        context.edges.extend(resolved_edges)

    context.artifacts["cross_paper_source_stubs"] = list(source_stubs.values())
    context.artifacts["cross_paper_stats"] = {
        "incoming": len(deduped),
        "candidate_count": len(candidates),
        "resolved_edges": len(resolved_edges),
        "superseded_edges": len(superseded),
        "dropped_below_threshold": dropped,
    }
    context.artifacts["superseded_edges"] = superseded
    return context
