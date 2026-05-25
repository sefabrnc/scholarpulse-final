"""Model interfaces and factories for pipeline passes."""

from __future__ import annotations

from typing import Tuple

from ..config import PipelineConfig
from .embedding import EmbeddingModel
from .intent import IntentModel
from .reranker import RerankerModel


def compute_algorithm_version(
    embedding_model: EmbeddingModel,
    reranker: RerankerModel,
    intent_model: IntentModel,
) -> str:
    backends = (embedding_model.backend, reranker.backend, intent_model.backend)
    if all(backend != "stub" for backend in backends):
        return "v1-colab-ml"
    if any(backend != "stub" for backend in backends):
        return "v1-colab-ml-partial"
    return "v0-skeleton"


def create_models(config: PipelineConfig) -> Tuple[EmbeddingModel, RerankerModel, IntentModel, str]:
    allow_real = config.use_real_models
    embedding_model = EmbeddingModel(model_name=config.embed_model, allow_real=allow_real)
    reranker = RerankerModel(model_name=config.rerank_model, allow_real=allow_real)
    intent_model = IntentModel(
        model_name=config.intent_model,
        allow_real=allow_real,
        citefusion_weights_dir=config.citefusion_weights_dir,
    )
    algorithm_version = compute_algorithm_version(embedding_model, reranker, intent_model)
    return embedding_model, reranker, intent_model, algorithm_version
