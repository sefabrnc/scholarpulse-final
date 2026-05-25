"""Coordinate validation gate before bulk ingest (pass6.5)."""

from __future__ import annotations

from typing import Dict, List, Tuple

from ..types import PipelineContext, SentenceNode

BOUNDS_TOLERANCE = 0.001


def _is_stub_node(node: SentenceNode) -> bool:
    if node.element_type == "reference":
        return node.norm_x == 0.0 and node.norm_y == 0.0 and node.norm_w == 1.0
    return False


def _validate_bounds(node: SentenceNode, page_count: int) -> List[str]:
    issues: List[str] = []
    if page_count > 0 and (node.page < 1 or node.page > page_count):
        issues.append(f"page_out_of_range:{node.page}")
    for name, value in (
        ("norm_x", node.norm_x),
        ("norm_y", node.norm_y),
        ("norm_w", node.norm_w),
        ("norm_h", node.norm_h),
    ):
        if value < 0.0 or value > 1.0:
            issues.append(f"{name}_out_of_range:{value}")
    if node.norm_w <= 0.0 or node.norm_h <= 0.0:
        issues.append("zero_dimension_bbox")
    if node.norm_x + node.norm_w > 1.0 + BOUNDS_TOLERANCE:
        issues.append("bbox_overflow_x")
    if node.norm_y + node.norm_h > 1.0 + BOUNDS_TOLERANCE:
        issues.append("bbox_overflow_y")
    return issues


def _denormalize_rect(node: SentenceNode, page_width: float, page_height: float) -> Tuple[float, float, float, float]:
    x0 = node.norm_x * page_width
    y0 = node.norm_y * page_height
    x1 = (node.norm_x + node.norm_w) * page_width
    y1 = (node.norm_y + node.norm_h) * page_height
    return (x0, y0, x1, y1)


def _text_overlap_ratio(text: str, rect_text: str) -> float:
    needle = " ".join(text.split()).strip().lower()
    haystack = " ".join(rect_text.split()).strip().lower()
    if not needle or not haystack:
        return 0.0
    if needle in haystack:
        return 1.0
    words = [word for word in needle.split() if len(word) > 2]
    if not words:
        return 0.0
    hits = sum(1 for word in words if word in haystack)
    return hits / len(words)


def _spot_check_node(node: SentenceNode, pdf_path: str, min_overlap: float) -> List[str]:
    issues: List[str] = []
    if not node.text.strip():
        return issues
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return ["pymupdf_unavailable"]

    doc = fitz.open(pdf_path)
    try:
        if node.page < 1 or node.page > doc.page_count:
            return [f"spot_page_out_of_range:{node.page}"]
        page = doc[node.page - 1]
        page_rect = page.rect
        rect = _denormalize_rect(node, page_rect.width, page_rect.height)
        rect_text = page.get_textbox(rect) or ""
        overlap = _text_overlap_ratio(node.text, rect_text)
        if overlap < min_overlap:
            issues.append(f"spot_overlap_low:{overlap:.3f}")
    finally:
        doc.close()
    return issues


def run(context: PipelineContext) -> PipelineContext:
    if context.skipped_reason or not context.config.coord_validate:
        return context

    page_count = int(context.artifacts.get("page_count") or 0)
    checked = 0
    failed = 0
    spot_checked = 0
    spot_failed = 0
    skipped_stub = 0
    issue_samples: List[str] = []

    for node in context.nodes:
        if node.element_type != "sentence" or not node.text.strip():
            continue
        if _is_stub_node(node):
            skipped_stub += 1
            continue

        checked += 1
        issues = _validate_bounds(node, page_count)
        if context.config.coord_spot_check and context.paper.pdf_path:
            spot_checked += 1
            issues.extend(
                _spot_check_node(
                    node,
                    context.paper.pdf_path,
                    float(context.config.min_coord_overlap),
                )
            )

        if issues:
            failed += 1
            if len(issue_samples) < 5:
                issue_samples.append(f"{node.sentence_id}:{','.join(issues)}")
            if any(issue.startswith("spot_overlap_low") for issue in issues):
                spot_failed += 1

    stats: Dict[str, object] = {
        "enabled": True,
        "spot_check": context.config.coord_spot_check,
        "checked_nodes": checked,
        "failed_nodes": failed,
        "spot_checked": spot_checked,
        "spot_failed": spot_failed,
        "skipped_stub_nodes": skipped_stub,
        "issue_samples": issue_samples,
        "block_ingest": False,
    }

    if failed > 0:
        context.warnings.append(f"coord_validation_failed:{failed}/{checked}")
        if context.config.coord_block_ingest:
            stats["block_ingest"] = True
            context.artifacts["coord_block_ingest"] = True

    context.artifacts["coord_validation"] = stats
    return context
