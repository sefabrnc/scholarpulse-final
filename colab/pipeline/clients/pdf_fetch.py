"""Download and cache PDF files for pipeline ingestion."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

import requests

from .canonicalization import normalize_doi

PDF_MAGIC = b"%PDF"
MIN_PDF_BYTES = 1024


def safe_doi_filename(doi: str) -> str:
    normalized = normalize_doi(doi)
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", normalized)
    return safe.strip("_") or "unknown_doi"


def is_valid_pdf_file(path: Path) -> bool:
    if not path.exists() or not path.is_file():
        return False
    if path.stat().st_size < MIN_PDF_BYTES:
        return False
    with path.open("rb") as handle:
        header = handle.read(5)
    return header.startswith(PDF_MAGIC)


class PdfFetcher:
    def __init__(
        self,
        cache_dir: str | Path,
        *,
        timeout_s: int = 90,
        user_agent: str = "ScholarPulse-Colab/1.0 (+https://github.com/scholarpulse)",
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.timeout_s = timeout_s
        self.user_agent = user_agent

    def cache_path_for_doi(self, doi: str) -> Path:
        return self.cache_dir / f"{safe_doi_filename(doi)}.pdf"

    def download(self, doi: str, url: str, *, force: bool = False) -> Path:
        cache_path = self.cache_path_for_doi(doi)
        if not force and is_valid_pdf_file(cache_path):
            return cache_path

        headers = {"User-Agent": self.user_agent, "Accept": "application/pdf,*/*"}
        response = requests.get(url, headers=headers, timeout=self.timeout_s, allow_redirects=True)
        response.raise_for_status()

        content_type = (response.headers.get("Content-Type") or "").lower()
        body = response.content
        if not body.startswith(PDF_MAGIC):
            if "pdf" not in content_type and "octet-stream" not in content_type:
                raise ValueError(f"URL did not return a PDF for DOI {doi}: {url}")
            if not body.startswith(PDF_MAGIC):
                raise ValueError(f"Downloaded bytes are not a PDF for DOI {doi}")

        if len(body) < MIN_PDF_BYTES:
            raise ValueError(f"Downloaded PDF is too small for DOI {doi}")

        tmp_path = cache_path.with_suffix(".pdf.part")
        tmp_path.write_bytes(body)
        tmp_path.replace(cache_path)
        return cache_path

    def get_cached(self, doi: str) -> Optional[Path]:
        cache_path = self.cache_path_for_doi(doi)
        if is_valid_pdf_file(cache_path):
            return cache_path
        return None
