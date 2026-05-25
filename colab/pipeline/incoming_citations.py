"""Gather incoming cross-paper citations from checkpoint + Worker."""

from __future__ import annotations

from typing import List, Optional

from .checkpoint import CheckpointStore
from .clients.worker_api import fetch_incoming_citations
from .config import PipelineConfig
from .cross_citations import IncomingCrossCitation, dedupe_incoming


def gather_incoming_cross_citations(
    target_doi: str,
    config: PipelineConfig,
    *,
    checkpoint_store: Optional[CheckpointStore] = None,
    preloaded: Optional[List[IncomingCrossCitation]] = None,
) -> List[IncomingCrossCitation]:
    collected: List[IncomingCrossCitation] = []
    if preloaded:
        for item in preloaded:
            if isinstance(item, IncomingCrossCitation):
                collected.append(item)
            elif isinstance(item, dict):
                mapped = IncomingCrossCitation.from_mapping(item)
                if mapped:
                    collected.append(mapped)
    if checkpoint_store is not None:
        collected.extend(checkpoint_store.load_cross_citations_for_target(target_doi))

    base_url = config.internal_api_base_url.strip()
    token = config.ingest_token
    if base_url and token:
        try:
            collected.extend(fetch_incoming_citations(base_url, token, target_doi))
        except Exception as exc:
            # Worker may be unavailable during local dry-runs; checkpoint data still works.
            if not collected:
                raise RuntimeError(f"incoming cross-citation lookup failed: {exc}") from exc

    return dedupe_incoming(collected)
