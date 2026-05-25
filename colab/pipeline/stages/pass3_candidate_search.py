"""Pass 3: FAISS/local vector candidate retrieval."""

from __future__ import annotations

import hashlib
import re
from typing import Dict, List, Optional

from ..index.faiss_local import DoiVectorIndexRegistry
from ..types import PipelineContext, SentenceNode


MARKER_REGEX = re.compile(r"\[(\d+)\]")


def _extract_ref_index(sentence: str) -> Optional[int]:
    match = MARKER_REGEX.search(sentence)
    if not match:
        return None
    return int(match.group(1))


def _synthetic_target_node(context: PipelineContext, resolved_doi: str, reference: Dict[str, object]) -> SentenceNode:
    ref_index = reference.get("ref_index")
    ref_label = f"ref-{ref_index}" if ref_index is not None else "ref"
    seed = f"{resolved_doi}|{ref_label}"
    node_id = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:32]
    text = str(reference.get("title") or reference.get("raw_text") or resolved_doi)
    return SentenceNode(
        sentence_id=node_id,
        doi=resolved_doi,
        page=1,
        norm_x=0.0,
        norm_y=0.0,
        norm_w=1.0,
        norm_h=0.01,
        element_type="reference",
        element_label=ref_label,
        text=text[:500],
    )


def run(context: PipelineContext) -> PipelineContext:
    if context.skipped_reason:
        return context

    node_embeddings = context.artifacts.get("node_embeddings", {})
    references = context.artifacts.get("resolved_references", [])
    if not isinstance(node_embeddings, dict) or not references:
        context.artifacts["candidates"] = []
        return context

    nodes_by_doi: Dict[str, List[str]] = {}
    node_by_id: Dict[str, SentenceNode] = {}
    for node in context.nodes:
        nodes_by_doi.setdefault(node.doi, []).append(node.sentence_id)
        node_by_id[node.sentence_id] = node

    registry = DoiVectorIndexRegistry()
    registry.build_from_embeddings(nodes_by_doi, node_embeddings)
    context.artifacts["vector_index_stats"] = {
        "doi_indexes": len(registry._by_doi),
        "total_vectors": sum(index.size for index in registry._by_doi.values()),
    }

    source_nodes = [node for node in context.nodes if node.element_type == "sentence" and node.text.strip()]
    candidates: List[Dict[str, object]] = []
    top_k = max(1, context.config.candidate_top_k)
    threshold = float(context.config.vector_score_threshold)
    pending_bibs: List[Dict[str, object]] = []

    for reference in references:
        resolved_doi = reference.get("resolved_doi")
        if not resolved_doi:
            continue
        resolved_doi_str = str(resolved_doi)
        ref_index = reference.get("ref_index")

        for source_node in source_nodes:
            marker_index = _extract_ref_index(source_node.text)
            if ref_index and marker_index and int(ref_index) != marker_index:
                continue
            source_vector = node_embeddings.get(source_node.sentence_id)
            if not isinstance(source_vector, list):
                continue

            hits = registry.search(resolved_doi_str, source_vector, top_k=top_k, min_score=threshold)
            if not hits:
                synthetic = _synthetic_target_node(context, resolved_doi_str, reference)
                context.nodes.append(synthetic)
                nodes_by_doi.setdefault(resolved_doi_str, []).append(synthetic.sentence_id)
                node_by_id[synthetic.sentence_id] = synthetic
                any_vector = next((vec for vec in node_embeddings.values() if isinstance(vec, list)), None)
                if any_vector:
                    node_embeddings[synthetic.sentence_id] = [0.0 for _ in any_vector]
                pending_bibs.append(
                    {
                        "source_doi": context.paper.doi,
                        "target_doi": resolved_doi_str,
                        "ref_index": ref_index,
                        "bib_text": reference.get("raw_text"),
                    }
                )
                hits = [(synthetic.sentence_id, 0.5)]

            for target_id, score in hits:
                target_node = node_by_id.get(target_id)
                if not target_node:
                    continue
                candidates.append(
                    {
                        "source_id": source_node.sentence_id,
                        "target_id": target_id,
                        "source_text": source_node.text,
                        "target_text": target_node.text or (target_node.element_label or ""),
                        "vector_score": float(score),
                        "ref_index": int(ref_index) if isinstance(ref_index, int) else marker_index,
                    }
                )

    context.artifacts["candidates"] = candidates
    context.artifacts["pending_bibs"] = pending_bibs
    return context
