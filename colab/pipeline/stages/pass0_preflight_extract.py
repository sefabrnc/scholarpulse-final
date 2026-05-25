"""Pass 0: pre-flight checks + text/figure/table extraction."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from ..helpers.figure_table import extract_figure_table_nodes
from ..policies.skip_policies import should_skip_paper_for_ocr, should_skip_sentence
from ..types import PipelineContext, SentenceNode

SENTENCE_SPLIT_REGEX = re.compile(r"(?<=[.!?])\s+")


def _make_sentence_id(
    doi: str, page: int, norm_rect: Tuple[float, float, float, float], text_seed: str = ""
) -> str:
    x, y, w, h = norm_rect
    normalized_seed = " ".join(text_seed.split()).strip().lower()
    key = f"{doi}|p{page}|x{x:.4f}|y{y:.4f}|w{w:.4f}|h{h:.4f}|t{normalized_seed}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def _split_sentences(text: str) -> List[str]:
    clean = " ".join(text.split())
    if not clean:
        return []
    parts = [chunk.strip() for chunk in SENTENCE_SPLIT_REGEX.split(clean)]
    return [part for part in parts if len(part) > 1]


def _normalize_bbox(
    bbox: Sequence[float], page_width: float, page_height: float
) -> Tuple[float, float, float, float]:
    x0, y0, x1, y1 = [float(v) for v in bbox[:4]]
    x0 = max(0.0, x0)
    y0 = max(0.0, y0)
    x1 = max(x0, x1)
    y1 = max(y0, y1)
    width = max(1.0, page_width)
    height = max(1.0, page_height)
    norm_x = round(min(1.0, x0 / width), 4)
    norm_y = round(min(1.0, y0 / height), 4)
    norm_w = round(min(1.0, (x1 - x0) / width), 4)
    norm_h = round(min(1.0, (y1 - y0) / height), 4)
    return (norm_x, norm_y, norm_w, norm_h)


def _union_line_bboxes(lines: Iterable[Dict[str, Any]]) -> Sequence[float] | None:
    raw_boxes: List[Sequence[float]] = []
    for line in lines:
        bbox = line.get("bbox")
        if isinstance(bbox, Sequence) and len(bbox) >= 4:
            raw_boxes.append(bbox)
    if not raw_boxes:
        return None
    x0 = min(float(box[0]) for box in raw_boxes)
    y0 = min(float(box[1]) for box in raw_boxes)
    x1 = max(float(box[2]) for box in raw_boxes)
    y1 = max(float(box[3]) for box in raw_boxes)
    return (x0, y0, x1, y1)


def _append_sentence_nodes(
    *,
    context: PipelineContext,
    page: int,
    page_width: float,
    page_height: float,
    block_text: str,
    block_bbox: Sequence[float],
    fonts: Iterable[str],
) -> None:
    norm_rect = _normalize_bbox(block_bbox, page_width, page_height)
    for sentence in _split_sentences(block_text):
        if should_skip_sentence(sentence, fonts):
            continue
        sentence_id = _make_sentence_id(context.paper.doi, page, norm_rect, sentence)
        context.nodes.append(
            SentenceNode(
                sentence_id=sentence_id,
                doi=context.paper.doi,
                page=page,
                norm_x=norm_rect[0],
                norm_y=norm_rect[1],
                norm_w=norm_rect[2],
                norm_h=norm_rect[3],
                text=sentence,
            )
        )


def _extract_from_metadata(context: PipelineContext) -> bool:
    pages = context.paper.metadata.get("pages")
    if not isinstance(pages, list):
        return False

    for page_obj in pages:
        if not isinstance(page_obj, dict):
            continue
        page_no = int(page_obj.get("page", 1))
        page_width = float(page_obj.get("width", 1000))
        page_height = float(page_obj.get("height", 1000))
        for block in page_obj.get("blocks", []):
            if not isinstance(block, dict):
                continue
            if int(block.get("type", 0)) != 0:
                continue
            lines = block.get("lines", [])
            union_bbox = _union_line_bboxes(lines) or block.get("bbox")
            if not union_bbox or len(union_bbox) < 4:
                continue
            block_text = " ".join(str(line.get("text", "")) for line in lines).strip()
            if not block_text:
                block_text = str(block.get("text", "")).strip()
            fonts = [str(span.get("font", "")) for line in lines for span in line.get("spans", [])]
            if not block_text:
                continue
            _append_sentence_nodes(
                context=context,
                page=page_no,
                page_width=page_width,
                page_height=page_height,
                block_text=block_text,
                block_bbox=union_bbox,
                fonts=fonts,
            )
    return len(context.nodes) > 0


def _extract_with_pymupdf(context: PipelineContext) -> bool:
    try:
        import fitz  # type: ignore
    except Exception:
        context.warnings.append("pymupdf_unavailable_for_pass0")
        return False

    try:
        doc = fitz.open(context.paper.pdf_path)
    except Exception as exc:  # pragma: no cover
        context.warnings.append(f"pymupdf_open_failed: {exc}")
        return False

    with doc:
        context.artifacts["page_count"] = doc.page_count
        for page_idx in range(doc.page_count):
            page = doc.load_page(page_idx)
            page_no = page_idx + 1
            page_width = float(page.rect.width)
            page_height = float(page.rect.height)

            page_dict = page.get_text("dict")
            blocks = page_dict.get("blocks", [])
            for block in blocks:
                if int(block.get("type", 0)) != 0:
                    continue
                lines = block.get("lines", [])
                union_bbox = _union_line_bboxes(lines) or block.get("bbox")
                if not union_bbox:
                    continue
                line_texts: List[str] = []
                fonts: List[str] = []
                for line in lines:
                    spans = line.get("spans", [])
                    line_text = "".join(str(span.get("text", "")) for span in spans).strip()
                    if line_text:
                        line_texts.append(line_text)
                    fonts.extend(str(span.get("font", "")) for span in spans)
                block_text = " ".join(line_texts).strip()
                if not block_text:
                    continue
                _append_sentence_nodes(
                    context=context,
                    page=page_no,
                    page_width=page_width,
                    page_height=page_height,
                    block_text=block_text,
                    block_bbox=union_bbox,
                    fonts=fonts,
                )

            context.warnings.extend(extract_figure_table_nodes(page, context, page_no))

    return len(context.nodes) > 0


def _load_pdf_plain_text(pdf_path: str, *, warnings: List[str] | None = None) -> str:
    """Extract full document text with PyMuPDF (plain text, then block spans)."""
    try:
        import fitz  # type: ignore
    except Exception as exc:
        if warnings is not None:
            warnings.append(f"pymupdf_unavailable:{exc.__class__.__name__}")
        return ""
    try:
        with fitz.open(pdf_path) as doc:
            plain = "".join(doc.load_page(i).get_text("text") for i in range(doc.page_count))
            if len(plain.strip()) >= 50:
                return plain

            block_parts: List[str] = []
            for page_idx in range(doc.page_count):
                page = doc.load_page(page_idx)
                page_dict = page.get_text("dict")
                for block in page_dict.get("blocks", []):
                    if int(block.get("type", 0)) != 0:
                        continue
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text = str(span.get("text", "")).strip()
                            if text:
                                block_parts.append(text)
            block_text = " ".join(block_parts)
            return block_text if len(block_text.strip()) >= len(plain.strip()) else plain
    except Exception as exc:
        if warnings is not None:
            warnings.append(f"pymupdf_plain_text_failed:{exc}")
        return ""


def _resolve_skip_reason(context: PipelineContext, text_len: int) -> str:
    if any("pymupdf_unavailable" in warning for warning in context.warnings):
        return "skipped_pymupdf_unavailable"
    if any("pymupdf_open_failed" in warning for warning in context.warnings):
        return "skipped_pdf_open_failed"
    context.warnings.append(f"ocr_skip_text_len={text_len}")
    return "skipped_ocr_required"


def run(context: PipelineContext) -> PipelineContext:
    raw_text = str(context.paper.metadata.get("raw_text", ""))
    pdf_path = str(context.paper.pdf_path or "").strip()
    if pdf_path and not raw_text.strip():
        pdf_text = _load_pdf_plain_text(pdf_path, warnings=context.warnings)
        if pdf_text.strip():
            raw_text = pdf_text

    if not raw_text:
        fallback_blocks = context.paper.metadata.get("pages", [])
        if isinstance(fallback_blocks, list):
            raw_text = " ".join(
                str(block.get("text", ""))
                for page in fallback_blocks
                if isinstance(page, dict)
                for block in page.get("blocks", [])
                if isinstance(block, dict)
            )
    context.extracted_text_len = len(raw_text)
    accumulated_text: List[str] = [raw_text] if raw_text else []

    extracted = _extract_with_pymupdf(context)
    if not extracted:
        _extract_from_metadata(context)

    if not accumulated_text or not accumulated_text[0]:
        if pdf_path:
            fallback_text = _load_pdf_plain_text(pdf_path, warnings=context.warnings)
            if fallback_text.strip():
                accumulated_text = [fallback_text]
        if not accumulated_text or not accumulated_text[0]:
            try:
                import fitz  # type: ignore

                with fitz.open(context.paper.pdf_path) as doc:
                    context.artifacts["page_count"] = doc.page_count
                    accumulated_text = [
                        "".join(doc.load_page(i).get_text("text") for i in range(doc.page_count))
                    ]
            except Exception as exc:
                context.warnings.append(f"pymupdf_plain_text_failed:{exc}")

    if accumulated_text:
        merged = " ".join(part for part in accumulated_text if part).strip()
        if merged:
            context.artifacts["raw_text"] = merged
            context.extracted_text_len = len(merged)
            raw_text = merged

    if should_skip_paper_for_ocr(
        text_len=context.extracted_text_len,
        node_count=len(context.nodes),
        min_extract_chars=context.config.min_extract_chars,
        bypass=context.config.disable_ocr_skip,
    ):
        context.skipped_reason = _resolve_skip_reason(context, context.extracted_text_len)
        return context

    if not context.nodes:
        # Keep pipeline alive with metadata fallback.
        sample_sentence = str(context.paper.metadata.get("sample_sentence", "")).strip()
        sample_fonts = context.paper.metadata.get("sample_fonts", [])
        if sample_sentence and not should_skip_sentence(sample_sentence, sample_fonts):
            norm_rect = (0.1, 0.1, 0.7, 0.05)
            context.nodes.append(
                SentenceNode(
                    sentence_id=_make_sentence_id(context.paper.doi, 1, norm_rect, sample_sentence),
                    doi=context.paper.doi,
                    page=1,
                    norm_x=norm_rect[0],
                    norm_y=norm_rect[1],
                    norm_w=norm_rect[2],
                    norm_h=norm_rect[3],
                    text=sample_sentence,
                )
            )
    return context

