#!/usr/bin/env python3
"""Colab/Kaggle production runner: 8-pass E2E batch ingest with Drive checkpoints."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from colab.pipeline.checkpoint import CheckpointStore
from colab.pipeline.config import PipelineConfig
from colab.pipeline.main import build_context, run_pipeline
from colab.pipeline.post_bulk_ingest import post_payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run 8-pass Colab pipeline over a manifest with Drive checkpoint resume.",
    )
    parser.add_argument(
        "--manifest",
        required=True,
        help="JSON array of {pdf, doi, metadata_json?} objects",
    )
    parser.add_argument(
        "--checkpoint-dir",
        help="Drive checkpoint directory (default: SP_CHECKPOINT_DIR)",
    )
    parser.add_argument(
        "--run-id",
        default="run-001",
        help="Run id subfolder under checkpoint-dir",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        help="Flush cursor every N papers (default: SP_CHECKPOINT_EVERY)",
    )
    parser.add_argument(
        "--out-dir",
        default="/tmp/scholarpulse/payloads",
        help="Directory for per-paper payload JSON files",
    )
    parser.add_argument("--ingest", action="store_true", help="POST each payload to bulk-ingest")
    parser.add_argument("--dry-run", action="store_true", help="Skip POST even with --ingest")
    parser.add_argument("--api-url", help="Bulk ingest URL (default: SP_INGEST_API_URL)")
    parser.add_argument("--token", help="Ingest token (default: SP_INGEST_TOKEN)")
    parser.add_argument(
        "--heartbeat-url",
        help="Optional heartbeat URL (default: SP_HEARTBEAT_URL)",
    )
    parser.add_argument(
        "--heartbeat-every",
        type=int,
        default=600,
        help="Heartbeat interval seconds while ingesting (0=off)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Process at most N pending papers (0=all)",
    )
    return parser.parse_args()


def load_manifest(path: str) -> List[Dict[str, Any]]:
    raw = Path(path).read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("manifest must be a JSON array")
    return [item for item in data if isinstance(item, dict)]


def _maybe_heartbeat(url: str, payload: Dict[str, Any]) -> None:
    if not url:
        return
    body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except Exception as exc:  # pragma: no cover - best effort
        print(f"heartbeat_failed: {exc}")


def run_batch(args: argparse.Namespace) -> int:
    config = PipelineConfig()
    checkpoint_root = args.checkpoint_dir or config.checkpoint_dir
    if not checkpoint_root:
        raise SystemExit("SP_CHECKPOINT_DIR or --checkpoint-dir is required for batch runner")

    checkpoint_dir = str(Path(checkpoint_root) / args.run_id)
    store = CheckpointStore(checkpoint_dir, run_id=args.run_id)
    cursor = store.load_cursor()
    checkpoint_every = args.checkpoint_every or config.checkpoint_every

    manifest = load_manifest(args.manifest)
    pending = list(store.iter_pending(manifest))
    if args.limit > 0:
        pending = pending[: args.limit]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    api_url = args.api_url or config.ingest_api_url
    token = args.token or config.ingest_token
    heartbeat_url = args.heartbeat_url or os.getenv("SP_HEARTBEAT_URL", "")
    last_heartbeat = 0.0

    print(f"checkpoint_dir={checkpoint_dir}")
    print(f"resume_processed={cursor.processed} pending={len(pending)}")

    failures = 0
    for index, item in enumerate(pending, start=1):
        pdf_path = str(item.get("pdf", "")).strip()
        doi = str(item.get("doi", "")).strip()
        metadata_path = item.get("metadata_json")
        if not pdf_path or not doi:
            print(f"skip_invalid_manifest_item index={index}")
            continue
        if not Path(pdf_path).exists():
            store.record(doi, "failed", error=f"missing_pdf:{pdf_path}")
            failures += 1
            continue

        print(f"[{index}/{len(pending)}] doi={doi}")
        try:
            context = build_context(
                pdf_path=pdf_path,
                doi=doi,
                metadata_path=str(metadata_path) if metadata_path else None,
                config=config,
            )
            payload = run_pipeline(context)
            payload_path = out_dir / f"{doi.replace('/', '_')}.json"
            payload_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

            if args.ingest and not args.dry_run:
                if not token:
                    raise RuntimeError("SP_INGEST_TOKEN or --token is required for --ingest")
                response = post_payload(api_url, token, payload, timeout=120)
                response.raise_for_status()

            store.record(doi, "ok", payload_path=str(payload_path))
            cursor.processed += 1
            cursor.last_doi = doi
            cursor.last_status = "ok"
        except Exception as exc:
            failures += 1
            store.record(doi, "failed", error=str(exc))
            cursor.last_doi = doi
            cursor.last_status = "failed"
            print(f"failed doi={doi} error={exc}")

        if index % checkpoint_every == 0:
            store.save_cursor(cursor)
            print(f"checkpoint_saved processed={cursor.processed}")

        now = time.time()
        if heartbeat_url and args.heartbeat_every > 0 and now - last_heartbeat >= args.heartbeat_every:
            _maybe_heartbeat(
                heartbeat_url,
                {
                    "run_id": args.run_id,
                    "processed": cursor.processed,
                    "last_doi": cursor.last_doi,
                    "platform": os.getenv("SP_COMPUTE_PLATFORM", "colab"),
                },
            )
            last_heartbeat = now

    store.save_cursor(cursor)
    print(f"done processed={cursor.processed} failures={failures}")
    return 1 if failures else 0


def main() -> None:
    args = parse_args()
    raise SystemExit(run_batch(args))


if __name__ == "__main__":
    main()
