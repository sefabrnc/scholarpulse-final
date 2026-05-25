"""Pass 6: citation marker post-validation."""

from __future__ import annotations

import re

from ..types import PipelineContext

MARKER_REGEX = re.compile(r"\[(\d+)\]")
ENUM_FALSE_POSITIVE_REGEX = re.compile(r"\(\s*\d+(?:\s*,\s*\d+)+\s*\)")


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
    valid_indexes = {
        int(ref.get("ref_index"))
        for ref in context.references
        if isinstance(ref.get("ref_index"), int)
    }
    validated_edges = []
    dropped = 0
    source_text_by_id = {node.sentence_id: node.text for node in context.nodes}
    for edge in context.edges:
        if edge.ref_index is None:
            text = source_text_by_id.get(edge.source_id, "")
            marker = MARKER_REGEX.search(text)
            if marker:
                edge.ref_index = int(marker.group(1))

        text = source_text_by_id.get(edge.source_id, "")
        if _is_enum_false_positive(text):
            dropped += 1
            continue

        if edge.ref_index is not None and valid_indexes and edge.ref_index not in valid_indexes:
            dropped += 1
            continue

        if edge.ref_index is not None and resolved_indexes and edge.ref_index not in resolved_indexes:
            dropped += 1
            continue

        validated_edges.append(edge)

    context.edges = validated_edges
    context.artifacts["validated_markers"] = {
        "ok": True,
        "kept_edges": len(validated_edges),
        "dropped_edges": dropped,
        "resolved_ref_indexes": sorted(resolved_indexes),
    }
    return context
