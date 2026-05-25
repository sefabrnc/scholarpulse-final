"""Download and cache PDF files for pipeline ingestion."""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Optional

import requests

from .canonicalization import normalize_doi

PDF_MAGIC = b"%PDF"
MIN_PDF_BYTES = 1024
HTML_SNIFF = re.compile(rb"^\s*(?:<!doctype\s+html|<html\b)", re.IGNORECASE)


def safe_doi_filename(doi: str) -> str:
    normalized = normalize_doi(doi)
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", normalized)
    return safe.strip("_") or "unknown_doi"


def looks_like_html(body: bytes) -> bool:
    sample = body[:512].lstrip()
    return bool(HTML_SNIFF.match(sample))


def is_valid_pdf_file(path: Path) -> bool:
    if not path.exists() or not path.is_file():
        return False
    if path.stat().st_size < MIN_PDF_BYTES:
        return False
    with path.open("rb") as handle:
        header = handle.read(5)
    return header.startswith(PDF_MAGIC)


def pdf_has_extractable_text(path: Path, *, min_chars: int = 50) -> bool:
    """Return True when PyMuPDF can read at least min_chars from the PDF."""
    if not is_valid_pdf_file(path):
        return False
    try:
        import fitz  # type: ignore
    except Exception:
        return True
    try:
        with fitz.open(str(path)) as doc:
            sample_pages = min(doc.page_count, 3)
            plain = "".join(doc.load_page(i).get_text("text") for i in range(sample_pages))
            if len(plain.strip()) >= min_chars:
                return True
            block_parts: List[str] = []
            for page_idx in range(sample_pages):
                page_dict = doc.load_page(page_idx).get_text("dict")
                for block in page_dict.get("blocks", []):
                    if int(block.get("type", 0)) != 0:
                        continue
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text = str(span.get("text", "")).strip()
                            if text:
                                block_parts.append(text)
            return len(" ".join(block_parts).strip()) >= min_chars
    except Exception:
        return False


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

    def download(
        self,
        doi: str,
        url: str,
        *,
        force: bool = False,
        min_text_chars: int = 0,
    ) -> Path:
        cache_path = self.cache_path_for_doi(doi)
        if (
            not force
            and is_valid_pdf_file(cache_path)
            and (min_text_chars <= 0 or pdf_has_extractable_text(cache_path, min_chars=min_text_chars))
        ):
            return cache_path

        if force and cache_path.exists():
            cache_path.unlink(missing_ok=True)

        headers = {"User-Agent": self.user_agent, "Accept": "application/pdf,*/*"}
        response = requests.get(url, headers=headers, timeout=self.timeout_s, allow_redirects=True)
        response.raise_for_status()

        content_type = (response.headers.get("Content-Type") or "").lower()
        body = response.content
        if looks_like_html(body):
            raise ValueError(f"URL returned HTML instead of a PDF for DOI {doi}: {url}")
        if "html" in content_type and not body.startswith(PDF_MAGIC):
            raise ValueError(f"Content-Type is HTML for DOI {doi}: {url}")
        if not body.startswith(PDF_MAGIC):
            if "pdf" not in content_type and "octet-stream" not in content_type:
                raise ValueError(f"URL did not return a PDF for DOI {doi}: {url}")
            raise ValueError(f"Downloaded bytes are not a PDF for DOI {doi}")

        if len(body) < MIN_PDF_BYTES:
            raise ValueError(f"Downloaded PDF is too small for DOI {doi}")

        tmp_path = cache_path.with_suffix(".pdf.part")
        tmp_path.write_bytes(body)
        tmp_path.replace(cache_path)
        if min_text_chars > 0 and not pdf_has_extractable_text(cache_path, min_chars=min_text_chars):
            cache_path.unlink(missing_ok=True)
            raise ValueError(
                f"Downloaded PDF has insufficient extractable text for DOI {doi} "
                f"(need >= {min_text_chars} chars)"
            )
        return cache_path

    def get_cached(self, doi: str, *, min_text_chars: int = 0) -> Optional[Path]:
        cache_path = self.cache_path_for_doi(doi)
        if not is_valid_pdf_file(cache_path):
            return None
        if min_text_chars > 0 and not pdf_has_extractable_text(cache_path, min_chars=min_text_chars):
            return None
        return cache_path
