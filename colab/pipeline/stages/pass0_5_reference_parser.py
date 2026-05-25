"""Pass 0.5: GROBID reference parsing with hybrid clean/dirty routing."""

from __future__ import annotations

import re
from typing import Any, Dict, List

from ..clients.grobid import GrobidClient
from ..helpers.pdf_quality import assess_pdf_for_grobid
from ..types import PipelineContext


REFERENCE_HEADING_REGEX = re.compile(
    r"^\s*(references|bibliography|works cited|literature cited|references and notes)\s*:?\s*$",
    flags=re.IGNORECASE,
)
REFERENCE_LINE_REGEX = re.compile(r"^\s*(?:\[(\d+)\]|(\d+)\.)\s+(.+)$")
DOI_REGEX = re.compile(r"(10\.\d{4,9}/\S+)", flags=re.IGNORECASE)
ARXIV_REGEX = re.compile(r"\barxiv:(\d{4}\.\d{4,5}(?:v\d+)?)\b", flags=re.IGNORECASE)
YEAR_REGEX = re.compile(r"\b(19|20)\d{2}[a-z]?\b")
AUTHOR_YEAR_REGEX = re.compile(r"^([A-Z][A-Za-z\-']+(?:\s+et\s+al\.?)?),?\s+(.+)$")


def _extract_doi(payload: str) -> str:
    doi_match = DOI_REGEX.search(payload)
    if doi_match:
        return doi_match.group(1).rstrip(".,);")
    arxiv_match = ARXIV_REGEX.search(payload)
    if arxiv_match:
        return f"10.48550/arxiv.{arxiv_match.group(1)}"
    return ""


def _extract_year(payload: str) -> int | None:
    year_match = YEAR_REGEX.search(payload)
    if not year_match:
        return None
    digits = re.sub(r"[^0-9]", "", year_match.group(0))
    return int(digits) if digits else None


def _extract_authors(payload: str) -> List[str]:
    match = AUTHOR_YEAR_REGEX.match(payload.strip())
    if not match:
        return []
    lead = match.group(1).strip()
    return [lead] if lead else []


def _is_continuation_line(line: str) -> bool:
    if REFERENCE_LINE_REGEX.match(line):
        return False
    if REFERENCE_HEADING_REGEX.match(line):
        return False
    lowered = line.lower()
    if lowered.startswith(("doi:", "http://", "https://", "arxiv:")):
        return True
    return line[:1].islower() or line.startswith(("pp.", "vol.", "no.", "in ", "Proc.", "Proceedings"))


def _fallback_regex_parse(raw_text: str) -> List[Dict[str, Any]]:
    references: List[Dict[str, Any]] = []
    in_reference_section = False
    ref_counter = 1
    pending: Dict[str, Any] | None = None

    def flush_pending() -> None:
        nonlocal pending
        if pending is None:
            return
        payload = str(pending.get("raw_text", "")).strip()
        pending["doi"] = _extract_doi(payload)
        pending["year"] = _extract_year(payload)
        pending["authors"] = _extract_authors(payload)
        references.append(pending)
        pending = None

    for line in raw_text.splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        if not in_reference_section:
            if REFERENCE_HEADING_REGEX.match(normalized):
                in_reference_section = True
            continue

        if pending is not None and _is_continuation_line(normalized):
            pending["raw_text"] = f"{pending['raw_text']} {normalized}".strip()
            continue

        flush_pending()

        match = REFERENCE_LINE_REGEX.match(normalized)
        if match:
            ref_index = int(match.group(1) or match.group(2) or ref_counter)
            payload = match.group(3).strip()
        else:
            ref_index = ref_counter
            payload = normalized

        pending = {
            "ref_index": ref_index,
            "raw_text": payload,
            "doi": "",
            "year": None,
            "title": "",
            "authors": [],
            "parse_backend": "regex",
        }
        ref_counter = max(ref_counter + 1, ref_index + 1)

    flush_pending()
    return references


def _raw_text(context: PipelineContext) -> str:
    artifact = context.artifacts.get("raw_text")
    if isinstance(artifact, str) and artifact.strip():
        return artifact
    return str(context.paper.metadata.get("raw_text", ""))


def _resolve_route(context: PipelineContext) -> str:
    mode = (context.config.grobid_mode or "auto").strip().lower()
    if mode == "regex":
        return "regex"
    if mode == "grobid":
        return "grobid"
    route, _metrics = assess_pdf_for_grobid(context)
    return "grobid" if route == "clean" else "regex"


def run(context: PipelineContext, grobid: GrobidClient) -> PipelineContext:
    if context.skipped_reason:
        return context

    route, metrics = assess_pdf_for_grobid(context)
    mode = (context.config.grobid_mode or "auto").strip().lower()
    selected = _resolve_route(context)
    context.artifacts["grobid_route"] = {
        "mode": mode,
        "selected": selected,
        "quality": route,
        "metrics": metrics,
    }

    raw_text = _raw_text(context)

    if selected == "regex":
        if mode == "auto" and route == "dirty":
            context.warnings.append(f"grobid_skipped_dirty_pdf:{metrics.get('reason', 'unknown')}")
        context.references = _fallback_regex_parse(raw_text)
        return context

    try:
        refs = grobid.process_references(context.paper.pdf_path)
        for ref in refs:
            ref.setdefault("parse_backend", "grobid")
        context.references = refs
    except Exception as exc:  # pragma: no cover - best effort fallback
        context.warnings.append(f"grobid_failed: {exc}")
        context.references = _fallback_regex_parse(raw_text)
    return context
