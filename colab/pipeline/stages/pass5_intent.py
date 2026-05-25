"""Pass 5: citation intent classification."""

from __future__ import annotations

from ..models.intent import IntentModel
from ..types import PipelineContext

INTENT_OUTPUT_KEYS = ("relation_type", "intent_confidence")


def run(context: PipelineContext, intent_model: IntentModel) -> PipelineContext:
    if context.skipped_reason:
        return context

    node_text_by_id = {node.sentence_id: node.text for node in context.nodes}
    intent_rows = []
    for edge in context.edges:
        source_text = node_text_by_id.get(edge.source_id, "")
        target_text = node_text_by_id.get(edge.target_id, "")
        relation_type, confidence = intent_model.predict(source_text, target_text)
        edge.relation_type = relation_type or "mentions"
        edge.intent_confidence = float(round(confidence, 6))
        row = {
            "source_id": edge.source_id,
            "target_id": edge.target_id,
            "relation_type": edge.relation_type,
            "intent_confidence": edge.intent_confidence,
        }
        for key in INTENT_OUTPUT_KEYS:
            if key not in row:
                raise ValueError(f"intent contract missing key: {key}")
        intent_rows.append(row)

    context.artifacts["intent_labels"] = intent_rows
    context.artifacts["intent_contract"] = {
        "model": intent_model.model_name,
        "labels": list(IntentModel.LABELS),
        "output_keys": list(INTENT_OUTPUT_KEYS),
        "edge_count": len(intent_rows),
    }
    return context

