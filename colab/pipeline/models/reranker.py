"""Cross-encoder reranker with sentence-transformers backend and lexical stub fallback."""

from __future__ import annotations

import logging
import re
from typing import List, Sequence, Tuple

from .loader import env_flag, log_model_load, normalize_ce_score, resolve_device, try_import, unload_heavy_model

logger = logging.getLogger(__name__)

DEFAULT_RERANK_CANDIDATES: Sequence[str] = (
    "Alibaba-NLP/gte-reranker-modernbert-base",
    "Qwen/Qwen3-Reranker-0.6B",
)


def _stub_score_pairs(pairs: List[Tuple[str, str]]) -> List[float]:
    scores: List[float] = []
    for source_text, target_text in pairs:
        source_tokens = set(re.findall(r"[a-z0-9]+", source_text.lower()))
        target_tokens = set(re.findall(r"[a-z0-9]+", target_text.lower()))
        if not source_tokens or not target_tokens:
            scores.append(0.0)
            continue
        overlap = len(source_tokens.intersection(target_tokens))
        union = len(source_tokens.union(target_tokens))
        jaccard = overlap / union if union else 0.0
        containment = overlap / max(1, len(source_tokens))
        score = (0.6 * containment) + (0.4 * jaccard)
        scores.append(round(min(1.0, max(0.0, score)), 6))
    return scores


class RerankerModel:
    def __init__(
        self,
        model_name: str,
        *,
        candidates: Sequence[str] | None = None,
        allow_real: bool = True,
        max_length: int = 512,
    ) -> None:
        self.requested_name = model_name
        self.model_name = model_name
        self.backend = "stub"
        self.max_length = max_length
        self._model = None
        self._device = resolve_device()

        if not allow_real or not env_flag("SP_USE_REAL_MODELS", True):
            log_model_load("reranker", model_name, "stub", "SP_USE_REAL_MODELS=0")
            return

        if try_import("sentence_transformers") is None:
            log_model_load("reranker", model_name, "stub", "sentence-transformers missing")
            return

        from sentence_transformers import CrossEncoder

        names = list(candidates or [model_name, *DEFAULT_RERANK_CANDIDATES])
        seen: set[str] = set()
        for candidate in names:
            if candidate in seen:
                continue
            seen.add(candidate)
            try:
                self._model = CrossEncoder(
                    candidate,
                    max_length=self.max_length,
                    device=self._device,
                    trust_remote_code=True,
                )
                self.model_name = candidate
                self.backend = "cross-encoder"
                log_model_load("reranker", candidate, self.backend, self._device)
                return
            except Exception as exc:  # pragma: no cover - runtime fallback
                logger.warning("reranker load failed for %s: %s", candidate, exc)

        log_model_load("reranker", model_name, "stub", "all candidates failed")

    @property
    def is_stub(self) -> bool:
        return self.backend == "stub"

    def release(self) -> None:
        unload_heavy_model(self, label=f"reranker:{self.backend}")

    def score_pairs(self, pairs: List[Tuple[str, str]]) -> List[float]:
        if not pairs:
            return []
        if self._model is None:
            return _stub_score_pairs(pairs)

        raw_scores = self._model.predict(
            list(pairs),
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return [round(normalize_ce_score(float(score)), 6) for score in raw_scores]
