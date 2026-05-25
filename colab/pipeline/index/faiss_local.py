"""Minimal in-memory vector index (FAISS optional, pure-Python fallback)."""

from __future__ import annotations

import math
from typing import Dict, List, Sequence, Tuple


def _cosine(lhs: Sequence[float], rhs: Sequence[float]) -> float:
    left = math.sqrt(sum(v * v for v in lhs))
    right = math.sqrt(sum(v * v for v in rhs))
    if left == 0.0 or right == 0.0:
        return 0.0
    return sum(a * b for a, b in zip(lhs, rhs)) / (left * right)


class MinimalVectorIndex:
    """Per-DOI flat index with optional faiss-cpu acceleration."""

    def __init__(self, dim: int | None = None) -> None:
        self._dim = dim
        self._ids: List[str] = []
        self._vectors: List[List[float]] = []
        self._faiss_index = None

    @property
    def size(self) -> int:
        return len(self._ids)

    def add(self, node_id: str, vector: Sequence[float]) -> None:
        values = [float(v) for v in vector]
        if self._dim is None:
            self._dim = len(values)
        if len(values) != self._dim:
            raise ValueError(f"vector dim mismatch: expected {self._dim}, got {len(values)}")
        self._ids.append(node_id)
        self._vectors.append(values)
        self._faiss_index = None

    def _ensure_faiss(self) -> bool:
        if self._faiss_index is not None:
            return True
        if not self._vectors or self._dim is None:
            return False
        try:
            import faiss  # type: ignore
            import numpy as np  # type: ignore

            matrix = np.array(self._vectors, dtype="float32")
            faiss.normalize_L2(matrix)
            index = faiss.IndexFlatIP(self._dim)
            index.add(matrix)
            self._faiss_index = index
            self._faiss_np = np
            return True
        except Exception:
            return False

    def search(self, query: Sequence[float], top_k: int, min_score: float = 0.0) -> List[Tuple[str, float]]:
        if not self._ids:
            return []
        k = max(1, min(top_k, len(self._ids)))
        query_vec = [float(v) for v in query]
        if self._dim is not None and len(query_vec) != self._dim:
            return []

        if self._ensure_faiss():
            np = self._faiss_np
            import faiss  # type: ignore

            q = np.array([query_vec], dtype="float32")
            faiss.normalize_L2(q)
            scores, indices = self._faiss_index.search(q, k)
            hits: List[Tuple[str, float]] = []
            for score, idx in zip(scores[0], indices[0]):
                if idx < 0:
                    continue
                value = float(score)
                if value >= min_score:
                    hits.append((self._ids[int(idx)], round(value, 6)))
            return hits

        scored: List[Tuple[str, float]] = []
        for node_id, vector in zip(self._ids, self._vectors):
            score = _cosine(query_vec, vector)
            if score >= min_score:
                scored.append((node_id, round(score, 6)))
        scored.sort(key=lambda item: item[1], reverse=True)
        return scored[:k]


class DoiVectorIndexRegistry:
    """Registry of per-DOI indexes built from pipeline embeddings."""

    def __init__(self) -> None:
        self._by_doi: Dict[str, MinimalVectorIndex] = {}

    def build_from_embeddings(
        self,
        nodes_by_doi: Dict[str, List[str]],
        embeddings: Dict[str, List[float]],
    ) -> None:
        self._by_doi.clear()
        for doi, node_ids in nodes_by_doi.items():
            index = MinimalVectorIndex()
            for node_id in node_ids:
                vector = embeddings.get(node_id)
                if isinstance(vector, list) and vector:
                    index.add(node_id, vector)
            if index.size > 0:
                self._by_doi[doi] = index

    def search(self, doi: str, query: Sequence[float], top_k: int, min_score: float) -> List[Tuple[str, float]]:
        index = self._by_doi.get(doi)
        if not index:
            return []
        return index.search(query, top_k=top_k, min_score=min_score)
