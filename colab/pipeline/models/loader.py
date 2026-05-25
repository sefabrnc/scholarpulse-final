"""Shared helpers for Colab T4 model loading with deterministic fallback."""

from __future__ import annotations

import gc
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Rough FP16 VRAM estimates for sequential load planning (T4 16 GB).
VRAM_ESTIMATE_GB = {
    "embedding": 1.3,   # Qwen3-Embedding-0.6B
    "reranker": 0.6,    # gte-reranker-modernbert-base
    "intent": 2.8,      # CiteFusion ensemble or SciBERT+XLNet proxy path
    "intent-fallback": 0.5,  # SciCite SciBERT only
}


def resolve_device() -> str:
    """Return cuda when available, otherwise cpu."""
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


def gpu_available() -> bool:
    return resolve_device() == "cuda"


def env_flag(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_path(name: str) -> Optional[str]:
    raw = os.getenv(name)
    if not raw:
        return None
    path = raw.strip()
    return path if path else None


def try_import(name: str):
    try:
        return __import__(name)
    except ImportError:
        return None


def sigmoid(value: float) -> float:
    import math

    if value >= 0:
        z = math.exp(-value)
        return 1.0 / (1.0 + z)
    z = math.exp(value)
    return z / (1.0 + z)


def normalize_ce_score(raw_score: float) -> float:
    """Map cross-encoder logits to [0, 1] for threshold gates."""
    if 0.0 <= raw_score <= 1.0:
        return float(raw_score)
    return sigmoid(float(raw_score))


def log_model_load(model_kind: str, model_name: str, backend: str, detail: Optional[str] = None) -> None:
    suffix = f" ({detail})" if detail else ""
    logger.info("%s backend=%s model=%s%s", model_kind, backend, model_name, suffix)


def vram_estimate_gb(model_kind: str) -> float:
    return VRAM_ESTIMATE_GB.get(model_kind, 1.0)


def unload_heavy_model(model: Any, *, label: str = "model") -> None:
    """Drop model weights and free GPU memory. Safe on CPU-only runs."""
    if model is None:
        return
    if hasattr(model, "_model"):
        model._model = None
    if hasattr(model, "_tokenizer"):
        model._tokenizer = None
    if hasattr(model, "_ensemble"):
        model._ensemble = None
    gc.collect()
    torch = try_import("torch")
    if torch is not None and torch.cuda.is_available():
        torch.cuda.empty_cache()
        logger.info("unloaded %s, cuda_mem_allocated_mb=%.0f", label, torch.cuda.memory_allocated() / 1e6)


def assert_vram_headroom(model_kind: str, *, limit_gb: float = 14.0) -> None:
    """Log a warning when a single model may exceed safe T4 headroom."""
    estimate = vram_estimate_gb(model_kind)
    if estimate > limit_gb:
        logger.warning("%s estimate %.1f GB exceeds %.1f GB T4 headroom", model_kind, estimate, limit_gb)
