"""Embedding model with sentence-transformers backend and deterministic stub fallback."""

from __future__ import annotations

import hashlib
import logging
from typing import List, Sequence

from .loader import env_flag, log_model_load, resolve_device, try_import, unload_heavy_model

logger = logging.getLogger(__name__)

DEFAULT_EMBED_CANDIDATES: Sequence[str] = (
    "Qwen/Qwen3-Embedding-0.6B",
    "BAAI/bge-m3",
)


def _stub_embed(texts: List[str], dim: int = 1024) -> List[List[float]]:
    vectors: List[List[float]] = []
    for text in texts:
        normalized = " ".join(text.split()).strip().lower()
        digest = hashlib.sha256(normalized.encode("utf-8")).digest()
        values: List[float] = []
        for idx in range(dim):
            byte_val = digest[idx % len(digest)]
            values.append((byte_val / 127.5) - 1.0)
        vectors.append(values)
    return vectors


class EmbeddingModel:
    def __init__(
        self,
        model_name: str,
        *,
        candidates: Sequence[str] | None = None,
        allow_real: bool = True,
    ) -> None:
        self.requested_name = model_name
        self.model_name = model_name
        self.backend = "stub"
        self.embedding_dim = 1024
        self._model = None
        self._device = resolve_device()

        if not allow_real or not env_flag("SP_USE_REAL_MODELS", True):
            log_model_load("embedding", model_name, "stub", "SP_USE_REAL_MODELS=0")
            return

        if try_import("sentence_transformers") is None:
            log_model_load("embedding", model_name, "stub", "sentence-transformers missing")
            return

        from sentence_transformers import SentenceTransformer

        names = list(candidates or [model_name, *DEFAULT_EMBED_CANDIDATES])
        seen: set[str] = set()
        for candidate in names:
            if candidate in seen:
                continue
            seen.add(candidate)
            try:
                self._model = SentenceTransformer(
                    candidate,
                    device=self._device,
                    trust_remote_code=True,
                )
                sample = self._model.encode(["warmup"], normalize_embeddings=True)
                self.embedding_dim = int(sample.shape[1])
                self.model_name = candidate
                self.backend = "sentence-transformers"
                log_model_load("embedding", candidate, self.backend, self._device)
                return
            except Exception as exc:  # pragma: no cover - runtime fallback
                logger.warning("embedding load failed for %s: %s", candidate, exc)

        log_model_load("embedding", model_name, "stub", "all candidates failed")

    @property
    def is_stub(self) -> bool:
        return self.backend == "stub"

    def release(self) -> None:
        unload_heavy_model(self, label=f"embedding:{self.backend}")

    def embed(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        if self._model is None:
            return _stub_embed(texts, dim=self.embedding_dim)

        vectors = self._model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return [vector.tolist() for vector in vectors]
