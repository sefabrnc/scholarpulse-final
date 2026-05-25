"""Pass 2: bibliography resolution + DOI canonicalization."""

from __future__ import annotations

import hashlib
from typing import Dict, Sequence

from ..clients.canonicalization import CanonicalDoiResolver, normalize_doi
from ..clients.openalex import OpenAlexRequestError
from ..config import get_bib_resolve_max_refs, get_skip_bib_resolve
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
        "parse_backend": reference.get("parse_backend"),
    }


def _references_are_zero_based(references: list) -> bool:
    if any(
        isinstance(ref.get("ref_index"), int) and int(ref["ref_index"]) == 0
        for ref in references
    ):
        return True
    return any(ref.get("parse_backend") == "grobid" for ref in references)


def normalize_ref_indexes(context: PipelineContext) -> None:
    """Unify GROBID 0-based and regex 1-based ref_index to 1-based markers."""
    references = context.references
    was_zero_based = _references_are_zero_based(references)
    if was_zero_based:
        for ref in references:
            ref_index = ref.get("ref_index")
            if isinstance(ref_index, int):
                ref["ref_index"] = ref_index + 1

    context.artifacts["ref_index_one_based"] = True
    context.artifacts["ref_index_was_zero_based"] = was_zero_based


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


def _resolve_paper_doi(context: PipelineContext, resolver: CanonicalDoiResolver) -> tuple[str, Dict[str, str]]:
    fallback_doi = normalize_doi(context.paper.doi) or context.paper.doi
    try:
        return resolver.resolve(fallback_doi, artifacts=context.artifacts)
    except OpenAlexRequestError as exc:
        warning = (
            f"OpenAlex paper DOI lookup failed for {fallback_doi} "
            f"(HTTP {exc.status_code}); using input DOI as-is"
        )
        context.warnings.append(warning)
        context.artifacts.setdefault("openalex_warnings", []).append(warning)
        return fallback_doi, {}


def run(context: PipelineContext, resolver: CanonicalDoiResolver) -> PipelineContext:
    if context.skipped_reason:
        return context

    skip_bib_resolve = get_skip_bib_resolve()
    max_refs = get_bib_resolve_max_refs()

    canonical_doi, alias_map = _resolve_paper_doi(context, resolver)
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

    if skip_bib_resolve:
        context.references = [_normalize_reference(raw_ref) for raw_ref in context.references]
        normalize_ref_indexes(context)
        context.artifacts["doi_aliases"] = all_aliases
        context.artifacts["resolved_references"] = context.references
        context.artifacts["bib_resolve_skipped"] = True
        context.warnings.append("SP_SKIP_BIB_RESOLVE=1: skipped OpenAlex reference resolution")
        return context

    resolved_refs = []
    openalex_search_count = 0
    for raw_ref in context.references:
        ref = _normalize_reference(raw_ref)
        resolved_doi = None
        ref_aliases: Dict[str, str] = {}

        try:
            if ref["doi"]:
                resolved_doi, ref_aliases = resolver.resolve(ref["doi"], artifacts=context.artifacts)
            if not resolved_doi:
                if max_refs is not None and openalex_search_count >= max_refs:
                    ref["resolved_doi"] = None
                    resolved_refs.append(ref)
                    continue
                resolved_doi, ref_aliases = resolver.search_and_resolve_reference(
                    ref,
                    artifacts=context.artifacts,
                )
                openalex_search_count += 1
        except OpenAlexRequestError as exc:
            ref_index = ref.get("ref_index")
            warning = (
                f"OpenAlex reference resolution failed for ref_index={ref_index} "
                f"(HTTP {exc.status_code}); leaving resolved_doi unset"
            )
            context.warnings.append(warning)
            context.artifacts.setdefault("openalex_warnings", []).append(warning)
            resolved_doi = None
            ref_aliases = {}

        if resolved_doi:
            ref["resolved_doi"] = resolved_doi
            ref["canonical_doi"] = resolved_doi
            resolved_refs.append(ref)
            all_aliases = _collect_aliases(all_aliases, ref_aliases)
        else:
            ref["resolved_doi"] = None
            resolved_refs.append(ref)

    if max_refs is not None and len(context.references) > max_refs:
        context.warnings.append(
            f"SP_BIB_RESOLVE_MAX_REFS={max_refs}: capped OpenAlex searches "
            f"({openalex_search_count} searched, {len(context.references)} total refs)"
        )
    context.artifacts["bib_resolve_openalex_searches"] = openalex_search_count

    # Keep context.references aligned for marker/intent passes.
    context.references = resolved_refs
    normalize_ref_indexes(context)
    resolved_refs = context.references
    context.artifacts["doi_aliases"] = all_aliases
    context.artifacts["resolved_references"] = resolved_refs
    return context
