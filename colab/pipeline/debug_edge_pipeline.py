"""Diagnostic trace for cite-edge pipeline (pass0–pass6).

Run from repo root:
  python -m colab.pipeline.debug_edge_pipeline --doi 10.48550/arXiv.1706.03762
  SP_USE_REAL_MODELS=0 python -m colab.pipeline.debug_edge_pipeline --doi ...
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from colab.pipeline.clients.canonicalization import CanonicalDoiResolver, normalize_doi
from colab.pipeline.clients.grobid import GrobidClient
from colab.pipeline.clients.openalex import OpenAlexClient
from colab.pipeline.config import PipelineConfig
from colab.pipeline.main import build_context
from colab.pipeline.models import EmbeddingModel, RerankerModel
from colab.pipeline.stages import (
    pass0_5_reference_parser,
    pass0_preflight_extract,
    pass1_embed,
    pass2_bib_resolve,
    pass3_candidate_search,
    pass4_rerank,
    pass5_intent,
    pass6_marker_validation,
)
from colab.pipeline.stages.pass3_candidate_search import MARKER_REGEX, _refs_are_zero_based

MARKER_IN_TEXT = re.compile(r"\[(\d+)\]")


def _count_cite_sentences(nodes) -> dict:
    total = 0
    with_marker = 0
    samples: list[str] = []
    for node in nodes:
        if node.element_type != "sentence" or not (node.text or "").strip():
            continue
        total += 1
        if MARKER_IN_TEXT.search(node.text):
            with_marker += 1
            if len(samples) < 5:
                samples.append(node.text[:120])
    return {"sentence_nodes": total, "cite_marker_sentences": with_marker, "samples": samples}


def _embedding_misses(nodes, embeddings: dict) -> dict:
    misses = 0
    for node in nodes:
        vec = embeddings.get(node.sentence_id)
        if not isinstance(vec, list):
            misses += 1
    return {"embedding_lookup_misses": misses, "embedding_keys": len(embeddings)}


def _ref_index_stats(references: list) -> dict:
    indexes = [int(r["ref_index"]) for r in references if isinstance(r.get("ref_index"), int)]
    resolved = sum(1 for r in references if r.get("resolved_doi"))
    return {
        "reference_count": len(references),
        "resolved_doi_count": resolved,
        "ref_index_min": min(indexes) if indexes else None,
        "ref_index_max": max(indexes) if indexes else None,
        "zero_based_refs": _refs_are_zero_based(references),
        "parse_backends": sorted({r.get("parse_backend", "?") for r in references}),
    }


def run_debug(doi: str, pdf_path: str | None, use_real: bool) -> dict:
    os.environ["SP_USE_REAL_MODELS"] = "1" if use_real else "0"
    config = PipelineConfig()
    context = build_context(doi=doi, config=config, pdf_path=pdf_path)

    openalex = OpenAlexClient(base_url=config.openalex_base_url)
    resolver = CanonicalDoiResolver(openalex=openalex, match_threshold=config.bib_match_threshold)
    grobid = GrobidClient(base_url=config.grobid_base_url)

    context = pass0_preflight_extract.run(context)
    pre0 = {
        "nodes": len(context.nodes),
        "skipped": context.skipped_reason,
        "extracted_text_len": context.extracted_text_len,
    }

    context = pass0_5_reference_parser.run(context, grobid=grobid)
    ref_stats = _ref_index_stats(context.references)

    embed = EmbeddingModel(model_name=config.embed_model, allow_real=use_real)
    rerank = RerankerModel(model_name=config.rerank_model, allow_real=use_real)
    try:
        context = pass1_embed.run(context, embedding_model=embed)
        cite_stats = _count_cite_sentences(context.nodes)
        miss_stats = _embedding_misses(context.nodes, context.artifacts.get("node_embeddings", {}))

        context = pass2_bib_resolve.run(context, resolver=resolver)
        post2_miss = _embedding_misses(context.nodes, context.artifacts.get("node_embeddings", {}))

        context = pass3_candidate_search.run(context, embedding_model=embed)
        pass3_diag = context.artifacts.get("pass3_diagnostics", {})

        edges_before_pass6 = []
        context = pass4_rerank.run(context, reranker=rerank)
        rerank_stats = dict(context.artifacts.get("rerank_stats", {}))
        edges_before_pass6 = len(context.edges)

        context = pass6_marker_validation.run(context)
        marker_stats = dict(context.artifacts.get("validated_markers", {}))
    finally:
        embed.release()
        rerank.release()

    return {
        "doi_input": doi,
        "doi_canonical": context.paper.doi,
        "use_real_models": use_real,
        "grobid_route": context.artifacts.get("grobid_route"),
        "pass0": pre0,
        "references": ref_stats,
        "cite_sentences": cite_stats,
        "embeddings_pass1": miss_stats,
        "embeddings_after_pass2": post2_miss,
        "pass3": pass3_diag,
        "rerank_stats": rerank_stats,
        "edges_before_pass6": edges_before_pass6,
        "validated_markers": marker_stats,
        "final_edges": len(context.edges),
        "warnings": list(context.warnings),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Trace cite-edge pipeline diagnostics.")
    parser.add_argument("--doi", required=True)
    parser.add_argument("--pdf", default=None)
    parser.add_argument("--real", action="store_true", help="Use real ML models (slow)")
    parser.add_argument("--out", default=None, help="Write JSON to file")
    args = parser.parse_args()

    report = run_debug(normalize_doi(args.doi) or args.doi, args.pdf, args.real)
    text = json.dumps(report, indent=2, ensure_ascii=True)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
