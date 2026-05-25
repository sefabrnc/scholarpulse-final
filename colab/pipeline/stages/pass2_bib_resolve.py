"""Pass 2: bibliography resolution + DOI canonicalization."""

from __future__ import annotations

import hashlib
from typing import Dict, Sequence

from ..clients.canonicalization import CanonicalDoiResolver
from ..types import PipelineContext


def _make_sentence_id(doi: str, page: int, norm_rect: Sequence[float], text_seed: str = "") -> str:
    x, y, w, h = norm_rect
    normalized_seed = " ".join(text_seed.split()).strip().lower()
    key = f"{doi}|p{page}|x{x:.4f}|y{y:.4f}|w{w:.4f}|h{h:.4f}|t{normalized_seed}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def _collect_aliases(base: Dict[str, str], new_aliases: Dict[str, str]) -> Dict[str, str]:
    merged = dict(base)
    for alias, canonical in new_aliases.items():
        merged[alias] = canonical
    return merged


def _normalize_reference(reference: Dict) -> Dict:
    return {
        "ref_index": reference.get("ref_index"),
        "raw_text": str(reference.get("raw_text", "")),
        "title": str(reference.get("title", "")),
        "authors": reference.get("authors", []) or [],
        "year": reference.get("year"),
        "doi": str(reference.get("doi", "")),
    }


def _remap_embedding_artifacts(
    context: PipelineContext,
    id_remap: Dict[str, str],
    canonical_doi: str,
) -> None:
    """Keep pass1 embeddings aligned after sentence_id regeneration."""
    if not id_remap:
        return

    embeddings = context.artifacts.get("node_embeddings")
    if isinstance(embeddings, dict):
        remapped: Dict[str, list] = {}
        for old_id, vector in embeddings.items():
            new_id = id_remap.get(str(old_id), str(old_id))
            remapped[new_id] = vector
        context.artifacts["node_embeddings"] = remapped

    vectors = context.artifacts.get("vectors")
    if not isinstance(vectors, dict):
        return

    for item in vectors.get("sentence", []):
        if not isinstance(item, dict):
            continue
        old_id = str(item.get("id", ""))
        new_id = id_remap.get(old_id)
        if not new_id:
            continue
        item["id"] = new_id
        metadata = item.get("metadata")
        if isinstance(metadata, dict):
            metadata["sentence_id"] = new_id
            metadata["doi"] = canonical_doi

    for item in vectors.get("paper", []):
        if not isinstance(item, dict):
            continue
        item["id"] = f"paper:{canonical_doi}"
        metadata = item.get("metadata")
        if isinstance(metadata, dict):
            metadata["doi"] = canonical_doi


def run(context: PipelineContext, resolver: CanonicalDoiResolver) -> PipelineContext:
    if context.skipped_reason:
        return context

    canonical_doi, alias_map = resolver.resolve(context.paper.doi)
    previous_doi = context.paper.doi
    context.paper.doi = canonical_doi
    all_aliases = dict(alias_map)

    # Canonical DOI changes must reflect node IDs before downstream passes.
    if previous_doi != canonical_doi:
        id_remap: Dict[str, str] = {}
        for node in context.nodes:
            old_id = node.sentence_id
            node.doi = canonical_doi
            node.sentence_id = _make_sentence_id(
                canonical_doi,
                node.page,
                (node.norm_x, node.norm_y, node.norm_w, node.norm_h),
                node.text or (node.element_label or node.element_type),
            )
            id_remap[old_id] = node.sentence_id
        _remap_embedding_artifacts(context, id_remap, canonical_doi)

    resolved_refs = []
    for raw_ref in context.references:
        ref = _normalize_reference(raw_ref)
        resolved_doi = None
        ref_aliases: Dict[str, str] = {}

        if ref["doi"]:
            resolved_doi, ref_aliases = resolver.resolve(ref["doi"])
        if not resolved_doi:
            resolved_doi, ref_aliases = resolver.search_and_resolve_reference(ref)

        if resolved_doi:
            ref["resolved_doi"] = resolved_doi
            ref["canonical_doi"] = resolved_doi
            resolved_refs.append(ref)
            all_aliases = _collect_aliases(all_aliases, ref_aliases)
        else:
            ref["resolved_doi"] = None
            resolved_refs.append(ref)

    # Keep context.references aligned for marker/intent passes.
    context.references = resolved_refs
    context.artifacts["doi_aliases"] = all_aliases
    context.artifacts["resolved_references"] = resolved_refs
    return context

