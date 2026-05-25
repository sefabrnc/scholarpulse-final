"""Serialize pipeline output into bulk-ingest payload chunks."""

from __future__ import annotations

import hashlib
import json
from typing import Dict, Iterable, Iterator, List, Sequence

from ..types import CiteEdge, SentenceNode


def _chunk_items(items: Sequence[Dict], size: int) -> Iterator[List[Dict]]:
    for idx in range(0, len(items), size):
        yield list(items[idx : idx + size])


def to_node_payload(node: SentenceNode) -> Dict:
    source_ref = f"{node.doi}#p{node.page}"
    title = node.text.strip() or (node.element_label or node.element_type.title())
    metadata_json = json.dumps(
        {
            "page": node.page,
            "norm_x": round(node.norm_x, 4),
            "norm_y": round(node.norm_y, 4),
            "norm_w": round(node.norm_w, 4),
            "norm_h": round(node.norm_h, 4),
            "element_type": node.element_type,
            "element_label": node.element_label or "",
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )
    return {
        "id": node.sentence_id,
        "source": "colab",
        "sourceRef": source_ref,
        "title": title[:400],
        "doiNorm": node.doi,
        "publicationYear": None,
        "venue": None,
        "nodeType": node.element_type,
        "metadataJson": metadata_json,
        "authorsText": None,
        "topicTerms": None,
        "rankSignal": None,
    }


def _edge_id(edge: CiteEdge) -> str:
    payload = f"{edge.source_id}|{edge.target_id}|{edge.ref_index}|{edge.relation_type}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def to_edge_payload(edge: CiteEdge) -> Dict:
    parts = []
    if edge.ref_index is not None:
        parts.append(f"ref:{edge.ref_index}")
    if edge.confidence_tier:
        parts.append(f"tier:{edge.confidence_tier}")
    if edge.ce_score:
        parts.append(f"ce:{round(float(edge.ce_score), 4)}")
    if edge.intent_confidence is not None:
        parts.append(f"intent:{round(float(edge.intent_confidence), 4)}")
    evidence_ref = ";".join(parts) if parts else None
    weight = edge.ce_score if edge.ce_score else edge.vector_score
    return {
        "id": _edge_id(edge),
        "fromNodeId": edge.source_id,
        "toNodeId": edge.target_id,
        "edgeType": edge.relation_type or "mentions",
        "weight": round(float(weight), 6),
        "evidenceRef": evidence_ref,
    }


def build_bulk_payload(
    papers: Iterable[Dict],
    max_papers_per_chunk: int = 50,
) -> List[Dict]:
    """
    Build payload chunks aligned with 50 paper/chunk policy.

    `papers` items are expected to contain:
    - doi
    - nodes (list[SentenceNode])
    - edges (list[CiteEdge])
    - vectors (dict with sentence[] and paper[])
    """
    normalized_papers = list(papers)
    chunks: List[Dict] = []

    for paper_group in _chunk_items(normalized_papers, max_papers_per_chunk):
        payload = {
            "nodes": [],
            "edges": [],
            "vectors": {"sentence": [], "paper": []},
        }
        for paper in paper_group:
            payload["nodes"].extend(to_node_payload(node) for node in paper.get("nodes", []))
            payload["edges"].extend(to_edge_payload(edge) for edge in paper.get("edges", []))
            vectors = paper.get("vectors") or {}
            payload["vectors"]["sentence"].extend(vectors.get("sentence", []))
            payload["vectors"]["paper"].extend(vectors.get("paper", []))
        chunks.append(payload)

    return chunks

