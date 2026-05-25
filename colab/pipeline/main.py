"""CLI entrypoint for Colab 8-pass ingestion pipeline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict

from .clients.canonicalization import CanonicalDoiResolver
from .clients.grobid import GrobidClient
from .clients.openalex import OpenAlexClient
from .config import PipelineConfig
from .models import EmbeddingModel, IntentModel, RerankerModel, compute_algorithm_version
from .stages import (
    pass0_5_reference_parser,
    pass0_preflight_extract,
    pass1_embed,
    pass2_bib_resolve,
    pass3_candidate_search,
    pass4_rerank,
    pass5_intent,
    pass6_marker_validation,
    pass7_bulk_serialize,
    pass8_cross_paper_resolve,
)
from .checkpoint import CheckpointStore
from .incoming_citations import gather_incoming_cross_citations
from .pdf_acquire import ensure_pdf_for_paper
from .types import PaperInput, PipelineContext


def build_context(
    doi: str,
    config: PipelineConfig,
    pdf_path: str | None = None,
    metadata_path: str | None = None,
) -> PipelineContext:
    metadata: Dict[str, Any] = {}
    if metadata_path:
        metadata = json.loads(Path(metadata_path).read_text(encoding="utf-8"))

    resolved_pdf, acquisition_meta = ensure_pdf_for_paper(
        doi=doi,
        pdf_path=pdf_path,
        config=config,
    )
    metadata.update(acquisition_meta)
    paper = PaperInput(doi=doi, pdf_path=resolved_pdf, metadata=metadata)
    return PipelineContext(config=config, paper=paper)


def run_pipeline(
    context: PipelineContext,
    *,
    checkpoint_store: CheckpointStore | None = None,
) -> Dict:
    openalex = OpenAlexClient(base_url=context.config.openalex_base_url)
    resolver = CanonicalDoiResolver(openalex=openalex, match_threshold=context.config.bib_match_threshold)
    grobid = GrobidClient(base_url=context.config.grobid_base_url)

    context = pass0_preflight_extract.run(context)
    context = pass0_5_reference_parser.run(context, grobid=grobid)

    embedding_model = EmbeddingModel(
        model_name=context.config.embed_model,
        allow_real=context.config.use_real_models,
    )
    try:
        context = pass1_embed.run(context, embedding_model=embedding_model)
    finally:
        embedding_model.release()

    context = pass2_bib_resolve.run(context, resolver=resolver)
    context = pass3_candidate_search.run(context)

    reranker = RerankerModel(
        model_name=context.config.rerank_model,
        allow_real=context.config.use_real_models,
    )
    try:
        context = pass4_rerank.run(context, reranker=reranker)
    finally:
        reranker.release()

    intent_model = IntentModel(
        model_name=context.config.intent_model,
        allow_real=context.config.use_real_models,
        citefusion_weights_dir=context.config.citefusion_weights_dir,
    )
    try:
        context = pass5_intent.run(context, intent_model=intent_model)
    finally:
        intent_model.release()

    algorithm_version = compute_algorithm_version(embedding_model, reranker, intent_model)
    context.artifacts["model_backends"] = {
        "embedding": {"model": embedding_model.model_name, "backend": embedding_model.backend},
        "reranker": {"model": reranker.model_name, "backend": reranker.backend},
        "intent": {"model": intent_model.model_name, "backend": intent_model.backend},
        "algorithm_version": algorithm_version,
    }

    context = pass6_marker_validation.run(context)

    if context.config.cross_paper_resolve:
        try:
            incoming = gather_incoming_cross_citations(
                context.paper.doi,
                context.config,
                checkpoint_store=checkpoint_store,
                preloaded=context.artifacts.get("incoming_cross_citations"),
            )
        except Exception as exc:
            context.warnings.append(f"cross_paper_lookup_failed:{exc}")
            incoming = context.artifacts.get("incoming_cross_citations") or []

        if incoming:
            cross_embed = EmbeddingModel(
                model_name=context.config.embed_model,
                allow_real=context.config.use_real_models,
            )
            cross_reranker = RerankerModel(
                model_name=context.config.rerank_model,
                allow_real=context.config.use_real_models,
            )
            cross_intent = IntentModel(
                model_name=context.config.intent_model,
                allow_real=context.config.use_real_models,
                citefusion_weights_dir=context.config.citefusion_weights_dir,
            )
            try:
                context = pass8_cross_paper_resolve.run(
                    context,
                    incoming,
                    embedding_model=cross_embed,
                    reranker=cross_reranker,
                    intent_model=cross_intent,
                )
                local_node_ids = {node.sentence_id for node in context.nodes}
                cross_edges = [edge for edge in context.edges if edge.source_id not in local_node_ids]
                intra_edges = [edge for edge in context.edges if edge.source_id in local_node_ids]
                if cross_edges:
                    stubs = context.artifacts.get("cross_paper_source_stubs") or []
                    source_text_by_id = {
                        str(stub.get("source_id")): str(stub.get("source_text") or "")
                        for stub in stubs
                        if isinstance(stub, dict) and stub.get("source_id")
                    }
                    filtered_cross, marker_dropped = pass6_marker_validation.filter_cross_paper_edges(
                        cross_edges,
                        source_text_by_id,
                    )
                    context.edges = intra_edges + filtered_cross
                    stats = context.artifacts.get("cross_paper_stats")
                    if isinstance(stats, dict):
                        stats["marker_dropped_edges"] = marker_dropped
            finally:
                cross_embed.release()
                cross_reranker.release()
                cross_intent.release()

    return pass7_bulk_serialize.run(context)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run scholarpulse colab pipeline skeleton.")
    parser.add_argument("--pdf", help="Local PDF path (optional when SP_AUTO_FETCH_PDF=1)")
    parser.add_argument("--doi", required=True, help="Paper DOI")
    parser.add_argument("--metadata-json", help="Optional metadata JSON file path")
    parser.add_argument("--out", help="Optional output payload path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = PipelineConfig()
    context = build_context(
        doi=args.doi,
        config=config,
        pdf_path=args.pdf,
        metadata_path=args.metadata_json,
    )
    payload = run_pipeline(context)
    payload_json = json.dumps(payload, indent=2, ensure_ascii=True)
    if args.out:
        Path(args.out).write_text(payload_json, encoding="utf-8")
    else:
        print(payload_json)


if __name__ == "__main__":
    main()

