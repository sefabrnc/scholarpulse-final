"""Shared dataclasses used by pipeline stages."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .config import PipelineConfig


@dataclass
class PaperInput:
    doi: str
    pdf_path: str
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SentenceNode:
    sentence_id: str
    doi: str
    page: int
    norm_x: float
    norm_y: float
    norm_w: float
    norm_h: float
    element_type: str = "sentence"
    element_label: Optional[str] = None
    text: str = ""


@dataclass
class CiteEdge:
    source_id: str
    target_id: str
    vector_score: float
    ce_score: float
    ref_index: Optional[int] = None
    relation_type: Optional[str] = None
    intent_confidence: Optional[float] = None
    confidence_tier: Optional[str] = None


@dataclass
class PipelineContext:
    config: PipelineConfig
    paper: PaperInput
    extracted_text_len: int = 0
    skipped_reason: Optional[str] = None
    references: List[Dict[str, Any]] = field(default_factory=list)
    nodes: List[SentenceNode] = field(default_factory=list)
    edges: List[CiteEdge] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    artifacts: Dict[str, Any] = field(default_factory=dict)

