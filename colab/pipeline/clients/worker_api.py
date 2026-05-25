"""Worker internal API helpers for cross-paper revalidation."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List

from ..cross_citations import IncomingCrossCitation


def fetch_incoming_citations(
    base_url: str,
    token: str,
    target_doi: str,
    *,
    limit: int = 200,
    timeout_s: int = 30,
) -> List[IncomingCrossCitation]:
    root = base_url.rstrip("/")
    query = urllib.parse.urlencode({"target_doi": target_doi, "limit": str(max(1, limit))})
    url = f"{root}/api/internal/incoming-citations?{query}"
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
        raise RuntimeError(f"incoming-citations HTTP {exc.code}: {detail}") from exc

    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise RuntimeError("incoming-citations returned non-object JSON")
    items = payload.get("items")
    if not isinstance(items, list):
        return []

    found: List[IncomingCrossCitation] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        mapped = IncomingCrossCitation.from_mapping(item)
        if mapped:
            found.append(mapped)
    return found


def complete_pending_bibs(
    base_url: str,
    token: str,
    *,
    ids: List[str] | None = None,
    target_dois: List[str] | None = None,
    timeout_s: int = 30,
) -> Dict[str, object]:
    root = base_url.rstrip("/")
    url = f"{root}/api/internal/pending-bibs/complete"
    body: Dict[str, object] = {}
    if ids:
        body["ids"] = ids
    if target_dois:
        body["target_dois"] = target_dois
    request = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=True).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"pending-bibs/complete HTTP {exc.code}: {detail}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("pending-bibs/complete returned non-object JSON")
    return payload
