"""Heuristics for routing clean PDFs to GROBID vs regex fallback."""

from __future__ import annotations

import re
from typing import Any, Dict, Tuple

from ..types import PipelineContext

REFERENCE_HEADING_REGEX = re.compile(
    r"^\s*(references|bibliography|works cited|literature cited|references and notes)\s*:?\s*$",
    flags=re.IGNORECASE,
)

# arXiv:2603.13651 — GROBID strong on digital English CS/biomed; weak on
# footnote-heavy, multilingual, and low-quality OCR scans.
NON_ASCII_RATIO_DIRTY = 0.18
CHARS_PER_PAGE_DIRTY = 450
GARBAGE_TOKEN_RATIO_DIRTY = 0.12

GARBAGE_TOKEN = re.compile(r"[^\w\s.,;:()\[\]\-/\"'&@#%+=<>{}|\\`~]")


def _page_count(context: PipelineContext) -> int:
    pages = context.paper.metadata.get("pages")
    if isinstance(pages, list) and pages:
        return len(pages)
    page_count = context.paper.metadata.get("page_count")
    if isinstance(page_count, int) and page_count > 0:
        return page_count
    artifacts_pages = context.artifacts.get("page_count")
    if isinstance(artifacts_pages, int) and artifacts_pages > 0:
        return artifacts_pages
    return max(1, context.extracted_text_len // 2000 or 1)


def _raw_text(context: PipelineContext) -> str:
    for key in ("raw_text",):
        value = context.paper.metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value
    artifact = context.artifacts.get("raw_text")
    if isinstance(artifact, str) and artifact.strip():
        return artifact
    return ""


def _non_ascii_ratio(text: str) -> float:
    if not text:
        return 0.0
    non_ascii = sum(1 for ch in text if ord(ch) > 127)
    return non_ascii / len(text)


def _garbage_ratio(text: str) -> float:
    if not text:
        return 0.0
    tokens = text.split()
    if not tokens:
        return 0.0
    noisy = sum(1 for token in tokens if GARBAGE_TOKEN.search(token))
    return noisy / len(tokens)


def _has_reference_section(text: str) -> bool:
    for line in text.splitlines():
        if REFERENCE_HEADING_REGEX.match(line.strip()):
            return True
    return False


def assess_pdf_for_grobid(context: PipelineContext) -> Tuple[str, Dict[str, Any]]:
    """Return (route, metrics) where route is 'clean' or 'dirty'."""
    metrics: Dict[str, Any] = {
        "skipped_reason": context.skipped_reason,
        "extracted_text_len": context.extracted_text_len,
        "warnings": list(context.warnings),
    }

    if context.skipped_reason:
        metrics["reason"] = "pipeline_skipped"
        return "dirty", metrics

    raw_text = _raw_text(context)
    page_count = _page_count(context)
    chars_per_page = context.extracted_text_len / page_count
    non_ascii = _non_ascii_ratio(raw_text)
    garbage = _garbage_ratio(raw_text)
    has_refs = _has_reference_section(raw_text)

    metrics.update(
        {
            "page_count": page_count,
            "chars_per_page": round(chars_per_page, 1),
            "non_ascii_ratio": round(non_ascii, 4),
            "garbage_token_ratio": round(garbage, 4),
            "has_reference_section": has_refs,
        }
    )

    reasons: list[str] = []
    if context.extracted_text_len < context.config.min_extract_chars:
        reasons.append("low_extract_chars")
    if chars_per_page < CHARS_PER_PAGE_DIRTY:
        reasons.append("low_chars_per_page")
    if non_ascii >= NON_ASCII_RATIO_DIRTY:
        reasons.append("high_non_ascii")
    if garbage >= GARBAGE_TOKEN_RATIO_DIRTY:
        reasons.append("high_garbage_tokens")
    if not has_refs:
        reasons.append("missing_reference_heading")
    if any("pymupdf" in warning for warning in context.warnings):
        reasons.append("pymupdf_warning")

    if reasons:
        metrics["reason"] = "+".join(reasons)
        return "dirty", metrics

    metrics["reason"] = "digital_english_with_refs"
    return "clean", metrics
