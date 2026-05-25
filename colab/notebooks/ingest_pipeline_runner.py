#!/usr/bin/env python3
"""Colab/Kaggle production runner: 8-pass E2E batch ingest with Drive checkpoints."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Set

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from colab.pipeline.checkpoint import CheckpointStore
from colab.pipeline.clients.worker_api import complete_pending_bibs
from colab.pipeline.config import PipelineConfig
from colab.pipeline.cross_citations import extract_outbound_cross_citations
from colab.pipeline.ingest_queue import fetch_ingest_queue, manifest_from_queue
from colab.pipeline.main import build_context, run_pipeline
from colab.pipeline.post_bulk_ingest import post_payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run 8-pass Colab pipeline over a manifest with Drive checkpoint resume.",
    )
    parser.add_argument(
        "--manifest",
        help="JSON array of {doi, pdf?, metadata_json?} objects",
    )
    parser.add_argument(
        "--poll-queue",
        action="store_true",
        help="Fetch DOIs from GET /api/internal/ingest-queue (requires SP_INTERNAL_API_BASE_URL)",
    )
    parser.add_argument(
        "--expand-references",
        action="store_true",
        help="After each paper, auto-queue pending_bibs target_doi entries",
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
        "--internal-api-url",
        help="Worker base URL for queue polling (default: SP_INTERNAL_API_BASE_URL)",
    )
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


def _resolve_manifest(args: argparse.Namespace, config: PipelineConfig) -> List[Dict[str, Any]]:
    manifest: List[Dict[str, Any]] = []
    if args.manifest:
        manifest.extend(load_manifest(args.manifest))
    if args.poll_queue:
        base_url = (args.internal_api_url or config.internal_api_base_url or "").strip()
        token = args.token or config.ingest_token
        if not base_url:
            raise SystemExit("SP_INTERNAL_API_BASE_URL or --internal-api-url is required for --poll-queue")
        if not token:
            raise SystemExit("SP_INGEST_TOKEN or --token is required for --poll-queue")
        queue_payload = fetch_ingest_queue(base_url, token)
        queue_items = manifest_from_queue(queue_payload)
        print(f"poll_queue pending_bibs={len(queue_items)}")
        manifest.extend(queue_items)
    if not manifest:
        raise SystemExit("Provide --manifest and/or --poll-queue")
    return manifest


def _pending_reference_items(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    meta = payload.get("meta")
    if not isinstance(meta, dict):
        return []
    pending = meta.get("pending_bibs")
    if not isinstance(pending, list):
        return []
    items: List[Dict[str, str]] = []
    for entry in pending:
        if not isinstance(entry, dict):
            continue
        target_doi = str(entry.get("target_doi", "")).strip()
        if target_doi:
            items.append({"doi": target_doi})
    return items


def _maybe_complete_pending_bibs(
    args: argparse.Namespace,
    config: PipelineConfig,
    *,
    doi: str,
    pending_bib_id: str = "",
) -> None:
    if not args.ingest or args.dry_run:
        return
    base_url = (args.internal_api_url or config.internal_api_base_url or "").strip()
    token = args.token or config.ingest_token
    if not base_url or not token:
        return
    ids = [pending_bib_id] if pending_bib_id else None
    try:
        result = complete_pending_bibs(
            base_url,
            token,
            ids=ids,
            target_dois=[doi],
        )
        completed = int(result.get("completed", 0)) if isinstance(result, dict) else 0
        if completed:
            print(f"pending_bibs_completed doi={doi} count={completed}")
    except Exception as exc:  # pragma: no cover - best effort
        print(f"pending_bibs_complete_failed doi={doi} error={exc}")


def run_batch(args: argparse.Namespace) -> int:
    config = PipelineConfig()
    checkpoint_root = args.checkpoint_dir or config.checkpoint_dir
    if not checkpoint_root:
        raise SystemExit("SP_CHECKPOINT_DIR or --checkpoint-dir is required for batch runner")

    checkpoint_dir = str(Path(checkpoint_root) / args.run_id)
    store = CheckpointStore(checkpoint_dir, run_id=args.run_id)
    cursor = store.load_cursor()
    checkpoint_every = args.checkpoint_every or config.checkpoint_every

    manifest = _resolve_manifest(args, config)
    pending = list(store.iter_pending(manifest))
    queued_dois: Set[str] = {str(item.get("doi", "")).strip() for item in pending if item.get("doi")}
    for manifest_doi in store.load_pending_manifest():
        if manifest_doi and manifest_doi not in queued_dois and not store.is_done(manifest_doi):
            pending.append({"doi": manifest_doi, "source": "checkpoint_manifest"})
            queued_dois.add(manifest_doi)
    work_queue: Deque[Dict[str, Any]] = deque(pending)

    if args.limit > 0:
        work_queue = deque(list(work_queue)[: args.limit])

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    api_url = args.api_url or config.ingest_api_url
    token = args.token or config.ingest_token
    heartbeat_url = args.heartbeat_url or os.getenv("SP_HEARTBEAT_URL", "")
    last_heartbeat = 0.0

    print(f"checkpoint_dir={checkpoint_dir}")
    print(f"resume_processed={cursor.processed} pending={len(work_queue)} auto_fetch={config.auto_fetch_pdf}")

    failures = 0
    index = 0
    while work_queue:
        item = work_queue.popleft()
        pdf_path = str(item.get("pdf", "")).strip() or None
        doi = str(item.get("doi", "")).strip()
        pending_bib_id = str(item.get("pending_bib_id", "")).strip()
        metadata_path = item.get("metadata_json")
        if not doi:
            print("skip_invalid_manifest_item missing_doi")
            continue
        if store.is_done(doi):
            continue

        index += 1
        print(f"[{index}] doi={doi}")
        try:
            context = build_context(
                doi=doi,
                config=config,
                pdf_path=pdf_path,
                metadata_path=str(metadata_path) if metadata_path else None,
            )
            payload = run_pipeline(context, checkpoint_store=store)
            payload_path = out_dir / f"{doi.replace('/', '_')}.json"
            payload_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

            outbound = extract_outbound_cross_citations(payload, doi)
            if outbound:
                stored = store.record_cross_citations(outbound)
                print(f"recorded_cross_citations count={stored}")

            superseded = payload.get("edge_supersedes")
            if isinstance(superseded, list) and superseded:
                resolved_ids = [
                    str(item.get("id"))
                    for item in superseded
                    if isinstance(item, dict) and item.get("id")
                ]
                if resolved_ids:
                    store.mark_cross_citations_resolved(resolved_ids)
                    print(f"resolved_cross_citations count={len(resolved_ids)}")

            cross_stats = (payload.get("meta") or {}).get("cross_paper_stats")
            if cross_stats:
                print(f"cross_paper_stats: {json.dumps(cross_stats, ensure_ascii=True)}")

            if args.ingest and not args.dry_run:
                if not token:
                    raise RuntimeError("SP_INGEST_TOKEN or --token is required for --ingest")
                response = post_payload(api_url, token, payload, timeout=120)
                response.raise_for_status()
                _maybe_complete_pending_bibs(
                    args,
                    config,
                    doi=doi,
                    pending_bib_id=pending_bib_id,
                )

            store.record(doi, "ok", payload_path=str(payload_path))
            store.clear_pending_manifest([doi])
            cursor.processed += 1
            cursor.last_doi = doi
            cursor.last_status = "ok"

            if args.expand_references:
                expanded: List[str] = []
                for ref_item in _pending_reference_items(payload):
                    ref_doi = ref_item["doi"]
                    if ref_doi in queued_dois or store.is_done(ref_doi):
                        continue
                    queued_dois.add(ref_doi)
                    work_queue.append(ref_item)
                    expanded.append(ref_doi)
                    print(f"queued_reference doi={ref_doi}")
                if expanded:
                    store.record_pending_manifest(expanded)
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
