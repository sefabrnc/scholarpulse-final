"""Pass 7: bulk-ingest payload assembly."""

from __future__ import annotations

from typing import Dict

from ..serializers.bulk_ingest import attach_cross_paper_source_stubs, build_bulk_payload
from ..types import PipelineContext


def run(context: PipelineContext) -> Dict:
    if context.skipped_reason:
        return {
            "nodes": [],
            "edges": [],
            "vectors": {"sentence": [], "paper": []},
            "skipped": {"status": context.skipped_reason, "doi": context.paper.doi},
        }

    paper_payload = {
        "doi": context.paper.doi,
        "nodes": context.nodes,
        "edges": context.edges,
        "vectors": context.artifacts.get("vectors", {"sentence": [], "paper": []}),
    }
    payload = build_bulk_payload([paper_payload], max_papers_per_chunk=context.config.max_papers_per_chunk)[0]
    stubs = context.artifacts.get("cross_paper_source_stubs", [])
    if isinstance(stubs, list) and stubs:
        attach_cross_paper_source_stubs(payload, stubs)
    superseded = context.artifacts.get("superseded_edges", [])
    if isinstance(superseded, list) and superseded:
        payload["edge_supersedes"] = superseded
    payload["meta"] = {
        "paperCount": 1,
        "doi": context.paper.doi,
        "doi_aliases": context.artifacts.get("doi_aliases", {}),
        "pending_bibs": context.artifacts.get("pending_bibs", []),
        "resolved_references": len(context.artifacts.get("resolved_references", [])),
        "algorithm_version": context.artifacts.get("model_backends", {}).get(
            "algorithm_version",
            context.config.default_algorithm_version,
        ),
        "model_backends": context.artifacts.get("model_backends", {}),
        "cross_paper_stats": context.artifacts.get("cross_paper_stats", {}),
        "rerank_stats": context.artifacts.get("rerank_stats", {}),
    }
    return payload

