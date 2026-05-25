"""Runtime configuration for the Colab citation pipeline."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    return float(value) if value is not None else default


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value is not None else default


def _env_str(name: str, default: str) -> str:
    return os.getenv(name, default)


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class PipelineConfig:
    min_extract_chars: int = _env_int("SP_MIN_EXTRACT_CHARS", 50)
    max_papers_per_chunk: int = _env_int("SP_MAX_PAPERS_PER_CHUNK", 50)
    candidate_top_k: int = _env_int("SP_CANDIDATE_TOP_K", 5)
    vector_score_threshold: float = _env_float("SP_VECTOR_SCORE_THRESHOLD", 0.50)
    ce_threshold: float = _env_float("SP_CE_THRESHOLD", 0.85)
    cross_paper_ce_threshold: float = _env_float("SP_CROSS_PAPER_CE_THRESHOLD", 0.65)
    high_confidence_threshold: float = _env_float("SP_HIGH_CONFIDENCE_THRESHOLD", 0.95)
    bib_match_threshold: float = _env_float("SP_BIB_MATCH_THRESHOLD", 0.92)
    openalex_base_url: str = _env_str("SP_OPENALEX_BASE_URL", "https://api.openalex.org")
    openalex_mailto: Optional[str] = os.getenv("SP_OPENALEX_MAILTO")
    unpaywall_email: Optional[str] = os.getenv("SP_UNPAYWALL_EMAIL")
    pdf_cache_dir: str = _env_str("SP_PDF_CACHE_DIR", "/tmp/scholarpulse/pdfs")
    pdf_fetch_timeout_s: int = _env_int("SP_PDF_FETCH_TIMEOUT_S", 90)
    auto_fetch_pdf: bool = os.getenv("SP_AUTO_FETCH_PDF", "1").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    cross_paper_resolve: bool = os.getenv("SP_CROSS_PAPER_RESOLVE", "1").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    internal_api_base_url: str = _env_str("SP_INTERNAL_API_BASE_URL", "")
    grobid_base_url: str = _env_str("SP_GROBID_BASE_URL", "http://localhost:8070")
    # auto: clean PDF -> GROBID, dirty -> regex; grobid: always GROBID (+ fallback); regex: always regex
    grobid_mode: str = _env_str("SP_GROBID_MODE", "auto").strip().lower()
    checkpoint_dir: Optional[str] = os.getenv("SP_CHECKPOINT_DIR")
    resume_checkpoint: Optional[str] = os.getenv("SP_RESUME_CHECKPOINT")
    checkpoint_every: int = _env_int("SP_CHECKPOINT_EVERY", 25)
    ingest_api_url: str = _env_str("SP_INGEST_API_URL", "http://localhost:8787/api/cite/bulk-ingest")
    ingest_token: Optional[str] = os.getenv("SP_INGEST_TOKEN")
    embed_model: str = _env_str("SP_EMBED_MODEL", "Qwen/Qwen3-Embedding-0.6B")
    rerank_model: str = _env_str("SP_RERANK_MODEL", "Alibaba-NLP/gte-reranker-modernbert-base")
    intent_model: str = _env_str("SP_INTENT_MODEL", "citefusion/scicite-ws")
    citefusion_weights_dir: Optional[str] = os.getenv("SP_CITEFUSION_WEIGHTS_DIR")
    use_real_models: bool = os.getenv("SP_USE_REAL_MODELS", "1").strip().lower() in {"1", "true", "yes", "on"}
    disable_ocr_skip: bool = (
        _env_bool("SP_DISABLE_OCR_SKIP")
        or _env_bool("SP_FORCE_INGEST")
        or os.getenv("SP_SKIP_OCR", "1").strip().lower() in {"0", "false", "no", "off"}
    )
    default_algorithm_version: str = _env_str("SP_ALGORITHM_VERSION", "v0-skeleton")

