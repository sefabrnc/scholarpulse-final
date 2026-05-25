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
)
from .types import PaperInput, PipelineContext


def build_context(pdf_path: str, doi: str, metadata_path: str | None, config: PipelineConfig) -> PipelineContext:
    metadata: Dict[str, Any] = {}
    if metadata_path:
        metadata = json.loads(Path(metadata_path).read_text(encoding="utf-8"))
    paper = PaperInput(doi=doi, pdf_path=pdf_path, metadata=metadata)
    return PipelineContext(config=config, paper=paper)


def run_pipeline(context: PipelineContext) -> Dict:
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
    return pass7_bulk_serialize.run(context)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run scholarpulse colab pipeline skeleton.")
    parser.add_argument("--pdf", required=True, help="Local PDF path")
    parser.add_argument("--doi", required=True, help="Paper DOI")
    parser.add_argument("--metadata-json", help="Optional metadata JSON file path")
    parser.add_argument("--out", help="Optional output payload path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = PipelineConfig()
    context = build_context(
        pdf_path=args.pdf,
        doi=args.doi,
        metadata_path=args.metadata_json,
        config=config,
    )
    payload = run_pipeline(context)
    payload_json = json.dumps(payload, indent=2, ensure_ascii=True)
    if args.out:
        Path(args.out).write_text(payload_json, encoding="utf-8")
    else:
        print(payload_json)


if __name__ == "__main__":
    main()

