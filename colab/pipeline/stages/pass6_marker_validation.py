"""Pass 6: citation marker post-validation."""

from __future__ import annotations

import re

from ..types import PipelineContext
from .pass3_candidate_search import MARKER_REGEX, _marker_matches_ref, extract_marker_indices

ENUM_FALSE_POSITIVE_REGEX = re.compile(r"\(\s*\d+(?:\s*,\s*\d+)+\s*\)")


def _edge_matches_resolved_reference(
    edge,
    source_text: str,
    references: list,
) -> bool:
    marker_indices = extract_marker_indices(source_text, references)
    if marker_indices:
        for ref in references:
            if not ref.get("resolved_doi"):
                continue
            ref_index = ref.get("ref_index")
            if isinstance(ref_index, int) and any(
                _marker_matches_ref(marker_index, ref_index) for marker_index in marker_indices
            ):
                return True
        return False
    if edge.ref_index is None:
        return True
    for ref in references:
        if not ref.get("resolved_doi"):
            continue
        if ref.get("ref_index") == edge.ref_index:
            return True
    return False


def _is_enum_false_positive(source_text: str) -> bool:
    """Disable edges tied to parenthetical enumerations like (1, 2, 3)."""
    return bool(ENUM_FALSE_POSITIVE_REGEX.search(source_text))


def run(context: PipelineContext) -> PipelineContext:
    if context.skipped_reason:
        return context

    resolved_indexes = {
        int(ref.get("ref_index"))
        for ref in context.references
        if isinstance(ref.get("ref_index"), int) and ref.get("resolved_doi")
    }
    validated_edges = []
    dropped = 0
    dropped_ref_index_mismatch = 0
    source_text_by_id = {node.sentence_id: node.text for node in context.nodes}
    for edge in context.edges:
        text = source_text_by_id.get(edge.source_id, "")
        if edge.ref_index is None:
            marker_indices = extract_marker_indices(text, context.references)
            if marker_indices:
                edge.ref_index = marker_indices[0]
            else:
                marker = MARKER_REGEX.search(text)
                if marker:
                    edge.ref_index = int(marker.group(1))

        if _is_enum_false_positive(text):
            dropped += 1
            continue

        if resolved_indexes and not _edge_matches_resolved_reference(
            edge,
            text,
            context.references,
        ):
            dropped += 1
            dropped_ref_index_mismatch += 1
            continue

        validated_edges.append(edge)

    context.edges = validated_edges
    context.artifacts["validated_markers"] = {
        "ok": True,
        "kept_edges": len(validated_edges),
        "dropped_edges": dropped,
        "dropped_ref_index_mismatch": dropped_ref_index_mismatch,
        "ref_index_one_based": context.artifacts.get("ref_index_one_based", True),
        "ref_index_was_zero_based": context.artifacts.get("ref_index_was_zero_based", False),
        "resolved_ref_indexes": sorted(resolved_indexes),
    }
    return context


def filter_cross_paper_edges(
    edges: list,
    source_text_by_id: dict[str, str],
) -> tuple[list, int]:
    """Apply marker false-positive filter to pass8 cross-paper edges only."""
    kept = []
    dropped = 0
    for edge in edges:
        text = source_text_by_id.get(edge.source_id, "")
        if _is_enum_false_positive(text):
            dropped += 1
            continue
        kept.append(edge)
    return kept, dropped
