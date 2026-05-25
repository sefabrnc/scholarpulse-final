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


def run(context: PipelineContext, resolver: CanonicalDoiResolver) -> PipelineContext:
    if context.skipped_reason:
        return context

    canonical_doi, alias_map = resolver.resolve(context.paper.doi)
    previous_doi = context.paper.doi
    context.paper.doi = canonical_doi
    all_aliases = dict(alias_map)

    # Canonical DOI changes must reflect node IDs before downstream passes.
    if previous_doi != canonical_doi:
        for node in context.nodes:
            node.doi = canonical_doi
            node.sentence_id = _make_sentence_id(
                canonical_doi,
                node.page,
                (node.norm_x, node.norm_y, node.norm_w, node.norm_h),
                node.text or (node.element_label or node.element_type),
            )

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

