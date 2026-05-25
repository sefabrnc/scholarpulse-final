"""Ensure a local PDF exists for a DOI before running the 8-pass pipeline."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .clients.openalex import OpenAlexClient
from .clients.pdf_fetch import PdfFetcher, is_valid_pdf_file
from .clients.pdf_resolver import PdfResolver
from .config import PipelineConfig


class PdfAcquisitionError(RuntimeError):
    """Raised when no PDF could be resolved or downloaded for a DOI."""


def ensure_pdf_for_paper(
    doi: str,
    pdf_path: Optional[str],
    config: PipelineConfig,
    *,
    openalex: Optional[OpenAlexClient] = None,
    force_fetch: bool = False,
) -> Tuple[str, Dict[str, Any]]:
    """
    Return (local_pdf_path, acquisition_meta).

    Uses an existing local path when provided. Otherwise resolves OA PDF URL and
    downloads into SP_PDF_CACHE_DIR when SP_AUTO_FETCH_PDF=1.
    """
    local_path = (pdf_path or "").strip()
    if local_path:
        path = Path(local_path)
        if not path.exists():
            raise PdfAcquisitionError(f"PDF not found: {local_path}")
        if not is_valid_pdf_file(path):
            raise PdfAcquisitionError(f"File is not a valid PDF: {local_path}")
        return str(path), {"pdf_source": "local", "pdf_path": str(path), "pdf_url": None}

    if not config.auto_fetch_pdf:
        raise PdfAcquisitionError(
            f"No PDF path for DOI {doi} and SP_AUTO_FETCH_PDF is disabled"
        )

    fetcher = PdfFetcher(cache_dir=config.pdf_cache_dir, timeout_s=config.pdf_fetch_timeout_s)
    cached = fetcher.get_cached(doi)
    if cached and not force_fetch:
        return str(cached), {
            "pdf_source": "cache",
            "pdf_path": str(cached),
            "pdf_url": None,
        }

    client = openalex or OpenAlexClient(
        base_url=config.openalex_base_url,
        mailto=config.openalex_mailto,
    )
    resolver = PdfResolver(
        client,
        unpaywall_email=config.unpaywall_email,
        timeout_s=config.pdf_fetch_timeout_s,
    )
    resolved = resolver.resolve_pdf_url(doi)
    if not resolved:
        raise PdfAcquisitionError(
            f"No open-access PDF URL found for DOI {doi}. "
            "Provide --pdf manually or set SP_UNPAYWALL_EMAIL."
        )

    downloaded = fetcher.download(doi, resolved.url, force=force_fetch)
    return str(downloaded), {
        "pdf_source": resolved.source,
        "pdf_path": str(downloaded),
        "pdf_url": resolved.url,
    }
