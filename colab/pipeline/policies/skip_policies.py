"""Reusable skip policies for pre-flight and sentence extraction."""

from __future__ import annotations

import re
from typing import Iterable

LATEX_PATTERN = re.compile(r"(\\\[.*?\\\]|\\\(.*?\\\)|\$\$.*?\$\$|\$[^$]+\$)", re.DOTALL)


def should_skip_for_ocr(text: str, min_extract_chars: int) -> bool:
    """Skip paper when extracted text is too short for reliable parsing."""
    return len(text.strip()) < min_extract_chars


def is_likely_math_sentence(text: str) -> bool:
    if LATEX_PATTERN.search(text):
        return True
    math_markers = (" theorem ", " lemma ", " corollary ", " integral ", " sum_")
    lowered = f" {text.lower()} "
    return any(marker in lowered for marker in math_markers)


def is_likely_code_sentence(text: str, font_names: Iterable[str]) -> bool:
    normalized_fonts = " ".join(font_names).lower()
    has_code_font = any(token in normalized_fonts for token in ("mono", "courier", "consolas"))
    has_code_tokens = any(token in text for token in ("{", "}", "=>", "::", "def ", "class ", "return "))
    return has_code_font or has_code_tokens


def should_skip_sentence(text: str, font_names: Iterable[str]) -> bool:
    return is_likely_math_sentence(text) or is_likely_code_sentence(text, font_names)

