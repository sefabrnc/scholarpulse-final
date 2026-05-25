#!/usr/bin/env python3
"""Run Colab pipeline for one PDF and optionally POST to bulk-ingest."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from colab.pipeline.config import PipelineConfig
from colab.pipeline.main import build_context, run_pipeline
from colab.pipeline.post_bulk_ingest import post_payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run 8-pass pipeline for one PDF and optionally POST to bulk-ingest.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--pdf", help="Local PDF path (optional when SP_AUTO_FETCH_PDF=1)")
    parser.add_argument("--doi", required=True, help="Paper DOI")
    parser.add_argument("--metadata-json", help="Optional metadata JSON path")
    parser.add_argument("--out", help="Write payload JSON to this path")
    parser.add_argument("--ingest", action="store_true", help="POST payload after pipeline run")
    parser.add_argument("--api-url", help="Bulk ingest URL (default: SP_INGEST_API_URL)")
    parser.add_argument("--token", help="Ingest token (default: SP_INGEST_TOKEN)")
    parser.add_argument("--dry-run", action="store_true", help="Skip POST even when --ingest is set")
    parser.add_argument(
        "--grobid-mode",
        choices=("auto", "grobid", "regex"),
        help="Override SP_GROBID_MODE (auto=clean->GROBID, dirty->regex)",
    )
    parser.add_argument(
        "--use-real-models",
        choices=("0", "1"),
        help="Override SP_USE_REAL_MODELS for this run",
    )
    parser.add_argument("--verbose", action="store_true", help="Print pipeline warnings and route metadata")
    return parser.parse_args()


def _apply_overrides(args: argparse.Namespace) -> None:
    if args.grobid_mode:
        os.environ["SP_GROBID_MODE"] = args.grobid_mode
    if args.use_real_models is not None:
        os.environ["SP_USE_REAL_MODELS"] = args.use_real_models


def _print_summary(payload: Dict[str, Any], verbose: bool) -> None:
    meta = payload.get("meta", {})
    if not isinstance(meta, dict):
        return
    print(
        "summary:",
        json.dumps(
            {
                "doi": meta.get("doi"),
                "algorithm_version": meta.get("algorithm_version"),
                "resolved_references": meta.get("resolved_references"),
                "resolved_doi_count": meta.get("resolved_doi_count"),
                "nodes": len(payload.get("nodes", []) or []),
                "edges": len(payload.get("edges", []) or []),
            },
            ensure_ascii=True,
        ),
    )
    if verbose:
        backends = meta.get("model_backends")
        if backends:
            print("model_backends:", json.dumps(backends, ensure_ascii=True))
        for key in ("pass3_diagnostics", "rerank_stats", "validated_markers"):
            value = meta.get(key)
            if value:
                print(f"{key}:", json.dumps(value, ensure_ascii=True))


def main() -> None:
    args = parse_args()
    _apply_overrides(args)

    if args.pdf and not Path(args.pdf).exists():
        raise SystemExit(f"PDF not found: {args.pdf}")

    config = PipelineConfig()
    context = build_context(
        doi=args.doi,
        config=config,
        pdf_path=args.pdf,
        metadata_path=args.metadata_json,
    )
    payload = run_pipeline(context)

    if args.verbose:
        route = context.artifacts.get("grobid_route")
        if route:
            print("grobid_route:", json.dumps(route, ensure_ascii=True))
        pdf_meta = {
            key: context.paper.metadata.get(key)
            for key in ("pdf_source", "pdf_url", "pdf_path")
            if context.paper.metadata.get(key) is not None
        }
        if pdf_meta:
            print("pdf_acquire:", json.dumps(pdf_meta, ensure_ascii=True))
        if context.warnings:
            print("warnings:", json.dumps(context.warnings, ensure_ascii=True))
        if context.skipped_reason:
            print(f"skipped_reason={context.skipped_reason}")

    payload_json = json.dumps(payload, indent=2, ensure_ascii=True)
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload_json, encoding="utf-8")
        print(f"wrote payload: {out_path}")
    else:
        print(payload_json)

    _print_summary(payload, verbose=args.verbose or not args.out)

    if args.ingest and not args.dry_run:
        api_url = args.api_url or config.ingest_api_url
        token = args.token or config.ingest_token
        if not token:
            raise SystemExit("SP_INGEST_TOKEN or --token is required for --ingest")
        response = post_payload(api_url, token, payload, timeout=120)
        response.raise_for_status()
        print("ingest response:")
        print(response.text)


if __name__ == "__main__":
    main()
