"""Pass 3: FAISS/local vector candidate retrieval."""

from __future__ import annotations

import hashlib
import re
from typing import Dict, List, Optional, Sequence

from ..index.faiss_local import DoiVectorIndexRegistry
from ..models.embedding import EmbeddingModel, _stub_embed
from ..types import PipelineContext, SentenceNode


MARKER_REGEX = re.compile(r"\[(\d+)\]")
SUPERSCRIPT_MAP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
SUPERSCRIPT_MARKER_REGEX = re.compile(r"[⁰¹²³⁴⁵⁶⁷⁸⁹]+")
AUTHOR_YEAR_MARKER_REGEX = re.compile(
    r"\(\s*([A-Z][A-Za-z\-'\s]+?(?:\s+et\s+al\.?)?)\s*,\s*((?:19|20)\d{2}[a-z]?)\s*\)",
    flags=re.IGNORECASE,
)


def _marker_matches_ref(marker_index: int, ref_index: int) -> bool:
    return marker_index == ref_index


def _extract_bracket_markers(sentence: str) -> List[int]:
    return [int(match.group(1)) for match in MARKER_REGEX.finditer(sentence)]


def _extract_superscript_markers(sentence: str) -> List[int]:
    markers: List[int] = []
    for match in SUPERSCRIPT_MARKER_REGEX.finditer(sentence):
        digits = match.group(0).translate(SUPERSCRIPT_MAP)
        if digits.isdigit():
            markers.append(int(digits))
    return markers


def _author_surname(author: str) -> str:
    token = author.strip().split()[-1].lower()
    return re.sub(r"[^a-z]", "", token)


def _extract_author_year_markers(sentence: str, references: Sequence[Dict[str, object]]) -> List[int]:
    markers: List[int] = []
    for match in AUTHOR_YEAR_MARKER_REGEX.finditer(sentence):
        author_hint = match.group(1).strip().lower()
        year_hint = re.sub(r"[^0-9]", "", match.group(2))
        if not year_hint:
            continue
        for reference in references:
            ref_index = reference.get("ref_index")
            if not isinstance(ref_index, int):
                continue
            ref_year = reference.get("year")
            if ref_year is None or str(ref_year) != year_hint:
                continue
            authors = reference.get("authors") or []
            if not isinstance(authors, list):
                continue
            for author in authors:
                surname = _author_surname(str(author))
                if surname and surname in author_hint:
                    markers.append(ref_index)
                    break
    return markers


def extract_marker_indices(sentence: str, references: Sequence[Dict[str, object]] | None = None) -> List[int]:
    markers = _extract_bracket_markers(sentence)
    markers.extend(_extract_superscript_markers(sentence))
    if references:
        markers.extend(_extract_author_year_markers(sentence, references))
    # Preserve order while deduplicating.
    seen: set[int] = set()
    ordered: List[int] = []
    for marker in markers:
        if marker in seen:
            continue
        seen.add(marker)
        ordered.append(marker)
    return ordered


def _extract_ref_index(sentence: str, references: Sequence[Dict[str, object]] | None = None) -> Optional[int]:
    markers = extract_marker_indices(sentence, references)
    return markers[0] if markers else None


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


def _embed_synthetic_target(
    text: str,
    *,
    embedding_model: EmbeddingModel | None,
    fallback_dim: int,
) -> List[float]:
    payload = text.strip()
    if not payload:
        return [0.0 for _ in range(fallback_dim)]
    if embedding_model is not None:
        return embedding_model.embed([payload])[0]
    return _stub_embed([payload], dim=fallback_dim)[0]


def run(context: PipelineContext, embedding_model: EmbeddingModel | None = None) -> PipelineContext:
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

    cite_marker_sentences = sum(
        1 for node in source_nodes if extract_marker_indices(node.text, references)
    )
    marker_mismatch = 0
    embedding_misses = 0
    empty_vector_hits = 0
    synthetic_targets = 0

    for reference in references:
        resolved_doi = reference.get("resolved_doi")
        if not resolved_doi:
            continue
        resolved_doi_str = str(resolved_doi)
        ref_index = reference.get("ref_index")

        for source_node in source_nodes:
            marker_indices = extract_marker_indices(source_node.text, references)
            if not marker_indices:
                continue
            if isinstance(ref_index, int) and not any(
                _marker_matches_ref(marker_index, ref_index) for marker_index in marker_indices
            ):
                marker_mismatch += 1
                continue
            source_vector = node_embeddings.get(source_node.sentence_id)
            if not isinstance(source_vector, list):
                embedding_misses += 1
                continue

            hits = registry.search(resolved_doi_str, source_vector, top_k=top_k, min_score=threshold)
            if not hits:
                empty_vector_hits += 1
                synthetic = _synthetic_target_node(context, resolved_doi_str, reference)
                context.nodes.append(synthetic)
                nodes_by_doi.setdefault(resolved_doi_str, []).append(synthetic.sentence_id)
                node_by_id[synthetic.sentence_id] = synthetic
                any_vector = next((vec for vec in node_embeddings.values() if isinstance(vec, list)), None)
                embed_text = synthetic.text.strip() or str(reference.get("raw_text") or resolved_doi_str)
                if any_vector:
                    node_embeddings[synthetic.sentence_id] = _embed_synthetic_target(
                        embed_text,
                        embedding_model=embedding_model,
                        fallback_dim=len(any_vector),
                    )
                pending_bibs.append(
                    {
                        "source_doi": context.paper.doi,
                        "target_doi": resolved_doi_str,
                        "ref_index": ref_index,
                        "bib_text": reference.get("raw_text"),
                    }
                )
                hits = [(synthetic.sentence_id, 0.5)]
                synthetic_targets += 1

            matched_marker = (
                ref_index
                if isinstance(ref_index, int)
                else marker_indices[0]
            )
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
                        "ref_index": int(matched_marker) if isinstance(matched_marker, int) else marker_indices[0],
                    }
                )

    context.artifacts["candidates"] = candidates
    context.artifacts["pending_bibs"] = pending_bibs
    context.artifacts["pass3_diagnostics"] = {
        "source_sentence_nodes": len(source_nodes),
        "cite_marker_sentences": cite_marker_sentences,
        "resolved_references": sum(1 for ref in references if ref.get("resolved_doi")),
        "ref_index_one_based": context.artifacts.get("ref_index_one_based", True),
        "ref_index_was_zero_based": context.artifacts.get("ref_index_was_zero_based", False),
        "marker_mismatch_skips": marker_mismatch,
        "embedding_lookup_misses": embedding_misses,
        "empty_vector_index_hits": empty_vector_hits,
        "synthetic_targets_created": synthetic_targets,
        "candidate_count": len(candidates),
        "vector_score_threshold": threshold,
    }
    return context
