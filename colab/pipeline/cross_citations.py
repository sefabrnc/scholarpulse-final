"""Cross-paper citation records and checkpoint persistence."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Set

REF_INDEX_REGEX = re.compile(r"ref:(\d+)", flags=re.IGNORECASE)


@dataclass(frozen=True)
class IncomingCrossCitation:
    edge_id: str
    source_id: str
    source_doi: str
    source_text: str
    old_target_id: str
    target_doi: str
    ref_index: Optional[int] = None

    @classmethod
    def from_mapping(cls, raw: Dict[str, Any]) -> Optional["IncomingCrossCitation"]:
        edge_id = str(raw.get("edge_id") or raw.get("old_edge_id") or "").strip()
        source_id = str(raw.get("source_id") or "").strip()
        source_doi = str(raw.get("source_doi") or "").strip()
        source_text = str(raw.get("source_text") or "").strip()
        old_target_id = str(raw.get("old_target_id") or "").strip()
        target_doi = str(raw.get("target_doi") or "").strip()
        if not edge_id or not source_id or not source_text or not old_target_id or not target_doi:
            return None
        ref_index = raw.get("ref_index")
        parsed_ref = int(ref_index) if isinstance(ref_index, int) else _parse_ref_index(raw.get("evidence_ref"))
        return cls(
            edge_id=edge_id,
            source_id=source_id,
            source_doi=source_doi,
            source_text=source_text,
            old_target_id=old_target_id,
            target_doi=target_doi,
            ref_index=parsed_ref,
        )


def _parse_ref_index(value: Any) -> Optional[int]:
    if isinstance(value, int):
        return value
    if not isinstance(value, str):
        return None
    match = REF_INDEX_REGEX.search(value)
    if not match:
        return None
    return int(match.group(1))


def dedupe_incoming(items: Iterable[IncomingCrossCitation]) -> List[IncomingCrossCitation]:
    seen: Set[str] = set()
    ordered: List[IncomingCrossCitation] = []
    for item in items:
        if item.edge_id in seen:
            continue
        seen.add(item.edge_id)
        ordered.append(item)
    return ordered


def extract_outbound_cross_citations(payload: Dict[str, Any], source_doi: str) -> List[IncomingCrossCitation]:
    """Find edges from this paper to placeholder reference nodes for other DOIs."""
    nodes = payload.get("nodes") or []
    edges = payload.get("edges") or []
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return []

    nodes_by_id: Dict[str, Dict[str, Any]] = {}
    for node in nodes:
        if isinstance(node, dict) and isinstance(node.get("id"), str):
            nodes_by_id[node["id"]] = node

    found: List[IncomingCrossCitation] = []
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        old_target_id = str(edge.get("toNodeId") or edge.get("to_node_id") or "").strip()
        source_id = str(edge.get("fromNodeId") or edge.get("from_node_id") or "").strip()
        edge_id = str(edge.get("id") or "").strip()
        if not old_target_id or not source_id or not edge_id:
            continue

        target_node = nodes_by_id.get(old_target_id)
        source_node = nodes_by_id.get(source_id)
        if not target_node or not source_node:
            continue

        target_doi = str(target_node.get("doiNorm") or target_node.get("doi_norm") or "").strip()
        if not target_doi or target_doi == source_doi:
            continue
        if str(target_node.get("nodeType") or target_node.get("node_type") or "") != "reference":
            continue

        mapped = IncomingCrossCitation.from_mapping(
            {
                "edge_id": edge_id,
                "source_id": source_id,
                "source_doi": source_doi,
                "source_text": str(source_node.get("title") or ""),
                "old_target_id": old_target_id,
                "target_doi": target_doi,
                "evidence_ref": edge.get("evidenceRef") or edge.get("evidence_ref"),
            }
        )
        if mapped:
            found.append(mapped)
    return found


def cross_citation_rows(items: Iterable[IncomingCrossCitation]) -> List[tuple]:
    now = time.time()
    rows: List[tuple] = []
    for item in items:
        rows.append(
            (
                item.edge_id,
                item.target_doi,
                item.source_doi,
                item.source_id,
                item.source_text,
                item.old_target_id,
                item.ref_index,
                "pending",
                now,
            )
        )
    return rows
