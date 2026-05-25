"""Pass 1: embedding generation placeholder."""

from __future__ import annotations

from typing import Dict, List

from ..models.embedding import EmbeddingModel
from ..policies.vector_metadata import sanitize_vector_metadata
from ..types import PipelineContext


def run(context: PipelineContext, embedding_model: EmbeddingModel) -> PipelineContext:
    if context.skipped_reason:
        return context

    node_texts: List[str] = []
    node_ids: List[str] = []
    node_pages: Dict[str, int] = {}
    for node in context.nodes:
        payload_text = node.text.strip() or (node.element_label or node.element_type)
        node_ids.append(node.sentence_id)
        node_pages[node.sentence_id] = node.page
        node_texts.append(payload_text)

    node_vectors = embedding_model.embed(node_texts) if node_texts else []
    node_embeddings: Dict[str, List[float]] = dict(zip(node_ids, node_vectors))
    context.artifacts["node_embeddings"] = node_embeddings

    paper_text = " ".join(
        [
            str(context.paper.metadata.get("title", "")).strip(),
            " ".join(context.paper.metadata.get("authors", []) or []),
            str(context.paper.metadata.get("abstract", "")).strip(),
        ]
    ).strip()
    paper_vector = embedding_model.embed([paper_text])[0] if paper_text else []

    vector_payload = {
        "sentence": [
            {
                "id": node_id,
                "values": vector,
                "metadata": sanitize_vector_metadata(
                    {
                        "doi": context.paper.doi,
                        "page": node_pages.get(node_id, 1),
                        "sentence_id": node_id,
                        "stage": "pass1",
                    },
                    group="sentence",
                ),
            }
            for node_id, vector in node_embeddings.items()
        ],
        "paper": (
            [
                {
                    "id": f"paper:{context.paper.doi}",
                    "values": paper_vector,
                    "metadata": sanitize_vector_metadata(
                        {
                            "doi": context.paper.doi,
                            "stage": "pass1",
                            "kind": "paper",
                        },
                        group="paper",
                    ),
                }
            ]
            if paper_vector
            else []
        ),
    }
    context.artifacts["vectors"] = vector_payload
    return context

