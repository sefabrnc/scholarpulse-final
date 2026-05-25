"""Vectorize metadata sanitizer: never persist sentence text in vector metadata."""

from __future__ import annotations

from typing import Any, Dict

FORBIDDEN_METADATA_KEYS = frozenset(
    {
        "text",
        "sentence",
        "sentence_text",
        "content",
        "body",
        "abstract",
        "snippet",
        "raw_text",
        "title",
        "authors",
        "caption",
    }
)

ALLOWED_METADATA_KEYS = frozenset(
    {
        "doi",
        "page",
        "sentence_id",
        "kind",
        "stage",
        "year",
        "citation_count",
        "doi_prefix",
    }
)


def sanitize_vector_metadata(raw: Dict[str, Any] | None, *, group: str) -> Dict[str, str | int | float | bool]:
    if not raw:
        return {}
    cleaned: Dict[str, str | int | float | bool] = {}
    for key, value in raw.items():
        normalized = str(key).strip().lower()
        if normalized in FORBIDDEN_METADATA_KEYS:
            raise ValueError(f"forbidden vector metadata key: {key}")
        if normalized not in ALLOWED_METADATA_KEYS:
            continue
        if isinstance(value, (str, int, float, bool)):
            cleaned[normalized] = value
    if group == "sentence" and "doi" not in cleaned:
        raise ValueError("sentence vector metadata requires doi")
    if group == "paper" and "doi" not in cleaned:
        raise ValueError("paper vector metadata requires doi")
    return cleaned
