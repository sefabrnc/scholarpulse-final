"""Poll Worker ingest queue and extract DOIs for auto-fetch pipeline runs."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, Iterable, List, Set

from .clients.canonicalization import is_valid_doi, normalize_doi


def _extract_doi_from_payload(payload: Dict[str, Any]) -> List[str]:
    found: List[str] = []
    for key in ("target_doi", "doi", "canonical_doi"):
        raw = payload.get(key)
        if isinstance(raw, str):
            normalized = normalize_doi(raw)
            if is_valid_doi(normalized):
                found.append(normalized)
    arxiv_id = payload.get("arxiv_id")
    if isinstance(arxiv_id, str) and arxiv_id.strip():
        normalized = normalize_doi(f"arxiv:{arxiv_id.strip()}")
        if is_valid_doi(normalized):
            found.append(normalized)
    return found


def dois_from_pending_bibs(items: Iterable[Dict[str, Any]]) -> List[str]:
    seen: Set[str] = set()
    ordered: List[str] = []
    for item in items:
        payload = item.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                payload = None
        if isinstance(payload, dict):
            for doi in _extract_doi_from_payload(payload):
                if doi not in seen:
                    seen.add(doi)
                    ordered.append(doi)
        source_ref = item.get("source_ref")
        if isinstance(source_ref, str):
            normalized = normalize_doi(source_ref)
            if is_valid_doi(normalized) and normalized not in seen:
                seen.add(normalized)
                ordered.append(normalized)
    return ordered


def fetch_ingest_queue(
    base_url: str,
    token: str,
    *,
    limit: int = 100,
    timeout_s: int = 30,
) -> Dict[str, Any]:
    root = base_url.rstrip("/")
    url = f"{root}/api/internal/ingest-queue?limit={max(1, limit)}"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ingest-queue HTTP {exc.code}: {detail}") from exc
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise RuntimeError("ingest-queue returned non-object JSON")
    return payload


def manifest_from_queue(queue_payload: Dict[str, Any]) -> List[Dict[str, str]]:
    pending = queue_payload.get("pending_bibs")
    if not isinstance(pending, list):
        pending = []
    manifest: List[Dict[str, str]] = []
    seen: Set[str] = set()
    for item in pending:
        if not isinstance(item, dict):
            continue
        pending_bib_id = str(item.get("id") or "").strip()
        payload = item.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                payload = None
        candidate_dois: List[str] = []
        if isinstance(payload, dict):
            candidate_dois.extend(_extract_doi_from_payload(payload))
        source_ref = item.get("source_ref")
        if isinstance(source_ref, str):
            normalized = normalize_doi(source_ref)
            if is_valid_doi(normalized):
                candidate_dois.append(normalized)
        for doi in candidate_dois:
            if doi in seen:
                continue
            seen.add(doi)
            entry: Dict[str, str] = {"doi": doi}
            if pending_bib_id:
                entry["pending_bib_id"] = pending_bib_id
            manifest.append(entry)
    return manifest
