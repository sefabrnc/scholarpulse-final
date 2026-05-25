"""Figure/table/image detection helpers for Pass 0."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Iterable, List, Sequence, Tuple

from ..types import PipelineContext, SentenceNode

FIGURE_LABEL_REGEX = re.compile(r"\b(figure|fig\.)\s*\d+[a-z]?\b", re.IGNORECASE)
TABLE_LABEL_REGEX = re.compile(r"\btable\s*\d+[a-z]?\b", re.IGNORECASE)


def detect_element_label(text_lines: Iterable[str], pattern: re.Pattern[str]) -> str | None:
    for line in text_lines:
        match = pattern.search(line)
        if match:
            return match.group(0)
    return None


def normalize_bbox(
    bbox: Sequence[float], page_width: float, page_height: float
) -> Tuple[float, float, float, float]:
    x0, y0, x1, y1 = [float(v) for v in bbox[:4]]
    x0 = max(0.0, x0)
    y0 = max(0.0, y0)
    x1 = max(x0, x1)
    y1 = max(y0, y1)
    width = max(1.0, page_width)
    height = max(1.0, page_height)
    return (
        round(min(1.0, x0 / width), 4),
        round(min(1.0, y0 / height), 4),
        round(min(1.0, (x1 - x0) / width), 4),
        round(min(1.0, (y1 - y0) / height), 4),
    )


def _make_node_id(
    doi: str, page: int, norm_rect: Tuple[float, float, float, float], seed: str
) -> str:
    x, y, w, h = norm_rect
    normalized_seed = " ".join(seed.split()).strip().lower()
    key = f"{doi}|p{page}|x{x:.4f}|y{y:.4f}|w{w:.4f}|h{h:.4f}|t{normalized_seed}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def _append_element_node(
    *,
    context: PipelineContext,
    page: int,
    page_width: float,
    page_height: float,
    bbox: Sequence[float],
    element_type: str,
    label: str | None,
) -> None:
    norm_rect = normalize_bbox(bbox, page_width, page_height)
    seed = label or element_type
    context.nodes.append(
        SentenceNode(
            sentence_id=_make_node_id(context.paper.doi, page, norm_rect, seed),
            doi=context.paper.doi,
            page=page,
            norm_x=norm_rect[0],
            norm_y=norm_rect[1],
            norm_w=norm_rect[2],
            norm_h=norm_rect[3],
            element_type=element_type,
            element_label=label,
            text="",
        )
    )


def extract_figure_table_nodes(page: Any, context: PipelineContext, page_no: int) -> List[str]:
    """Extract table/figure/image nodes from a PyMuPDF page. Returns warning tokens."""
    warnings: List[str] = []
    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    nearby_lines = [line.strip() for line in page.get_text("text").splitlines() if line.strip()]

    try:
        tables = page.find_tables()
        for table in tables.tables:
            _append_element_node(
                context=context,
                page=page_no,
                page_width=page_width,
                page_height=page_height,
                bbox=table.bbox,
                element_type="table",
                label=detect_element_label(nearby_lines, TABLE_LABEL_REGEX),
            )
    except Exception:
        warnings.append(f"table_detection_failed_p{page_no}")

    try:
        for cluster_bbox in page.cluster_drawings():
            _append_element_node(
                context=context,
                page=page_no,
                page_width=page_width,
                page_height=page_height,
                bbox=cluster_bbox,
                element_type="figure",
                label=detect_element_label(nearby_lines, FIGURE_LABEL_REGEX),
            )
    except Exception:
        warnings.append(f"figure_detection_failed_p{page_no}")

    try:
        for image in page.get_image_info(xrefs=True):
            bbox = image.get("bbox")
            if bbox:
                _append_element_node(
                    context=context,
                    page=page_no,
                    page_width=page_width,
                    page_height=page_height,
                    bbox=bbox,
                    element_type="image",
                    label=None,
                )
    except Exception:
        warnings.append(f"image_detection_failed_p{page_no}")

    return warnings
