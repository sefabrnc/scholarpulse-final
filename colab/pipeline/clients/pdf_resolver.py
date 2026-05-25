"""Resolve open-access PDF URLs from DOI via OpenAlex, Unpaywall, and arXiv."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import requests

from .canonicalization import normalize_doi
from .openalex import OpenAlexClient

ARXIV_DOI_REGEX = re.compile(
    r"10\.48550/arxiv\.(\d{4}\.\d{4,5}(?:v\d+)?)",
    flags=re.IGNORECASE,
)
PDF_URL_HINT = re.compile(r"(\.pdf(?:\?|$)|/pdf/|arxiv\.org/pdf/)", flags=re.IGNORECASE)


@dataclass(frozen=True)
class PdfResolveResult:
    doi: str
    url: str
    source: str


def arxiv_pdf_url_from_doi(doi: str) -> Optional[str]:
    normalized = normalize_doi(doi)
    match = ARXIV_DOI_REGEX.search(normalized)
    if not match:
        return None
    arxiv_id = match.group(1)
    return f"https://arxiv.org/pdf/{arxiv_id}.pdf"


def _looks_like_pdf_url(url: str) -> bool:
    value = url.strip().lower()
    if not value.startswith("https://"):
        return False
    return bool(PDF_URL_HINT.search(value))


def _pick_openalex_pdf(work: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    best = work.get("best_oa_location")
    if isinstance(best, dict):
        pdf_url = best.get("pdf_url")
        if isinstance(pdf_url, str) and pdf_url.strip():
            return pdf_url.strip(), "openalex_best_oa"

    open_access = work.get("open_access")
    if isinstance(open_access, dict):
        oa_url = open_access.get("oa_url")
        if isinstance(oa_url, str) and _looks_like_pdf_url(oa_url):
            return oa_url.strip(), "openalex_oa_url"

    primary = work.get("primary_location")
    if isinstance(primary, dict):
        pdf_url = primary.get("pdf_url")
        if isinstance(pdf_url, str) and pdf_url.strip():
            return pdf_url.strip(), "openalex_primary"

    return None


class PdfResolver:
    def __init__(
        self,
        openalex: OpenAlexClient,
        *,
        unpaywall_email: Optional[str] = None,
        timeout_s: int = 30,
    ) -> None:
        self.openalex = openalex
        self.unpaywall_email = (unpaywall_email or "").strip() or None
        self.timeout_s = timeout_s

    def resolve_pdf_url(self, doi: str) -> Optional[PdfResolveResult]:
        normalized = normalize_doi(doi)
        if not normalized:
            return None

        arxiv_url = arxiv_pdf_url_from_doi(normalized)
        if arxiv_url:
            return PdfResolveResult(doi=normalized, url=arxiv_url, source="arxiv_doi")

        work = self.openalex.get_work_by_doi(normalized)
        if work:
            openalex_hit = _pick_openalex_pdf(work)
            if openalex_hit:
                url, source = openalex_hit
                return PdfResolveResult(doi=normalized, url=url, source=source)

        unpaywall_hit = self._resolve_via_unpaywall(normalized)
        if unpaywall_hit:
            url, source = unpaywall_hit
            return PdfResolveResult(doi=normalized, url=url, source=source)

        return None

    def _resolve_via_unpaywall(self, doi: str) -> Optional[Tuple[str, str]]:
        if not self.unpaywall_email:
            return None
        response = requests.get(
            f"https://api.unpaywall.org/v2/{doi}",
            params={"email": self.unpaywall_email},
            timeout=self.timeout_s,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            return None

        best = payload.get("best_oa_location")
        if isinstance(best, dict):
            for key in ("url_for_pdf", "url"):
                candidate = best.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    url = candidate.strip()
                    if _looks_like_pdf_url(url) or "arxiv.org" in url.lower():
                        return url, "unpaywall_best_oa"

        locations = payload.get("oa_locations")
        if isinstance(locations, list):
            for location in locations:
                if not isinstance(location, dict):
                    continue
                candidate = location.get("url_for_pdf") or location.get("url")
                if isinstance(candidate, str) and candidate.strip():
                    url = candidate.strip()
                    if _looks_like_pdf_url(url):
                        return url, "unpaywall_oa_location"

        return None
