#!/usr/bin/env python3
"""One-shot generator for coord fixtures and citation benchmark sample rows."""

from __future__ import annotations

import csv
import hashlib
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EPSILON = 0.0001
DECIMALS = 4


class PageSize:
    def __init__(self, width: float, height: float) -> None:
        self.width = width
        self.height = height


class BBox:
    def __init__(self, x0: float, y0: float, x1: float, y1: float) -> None:
        self.x0 = x0
        self.y0 = y0
        self.x1 = x1
        self.y1 = y1


class NormRect:
    def __init__(self, x: float, y: float, width: float, height: float) -> None:
        self.x = x
        self.y = y
        self.width = width
        self.height = height


def clamp01(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return min(1.0, max(0.0, value))


def clamp_norm_rect(rect: NormRect) -> NormRect:
    x0 = clamp01(rect.x)
    y0 = clamp01(rect.y)
    x1 = clamp01(rect.x + rect.width)
    y1 = clamp01(rect.y + rect.height)
    return NormRect(
        min(x0, x1),
        min(y0, y1),
        max(EPSILON, abs(x1 - x0)),
        max(EPSILON, abs(y1 - y0)),
    )


def pymupdf_normalize_bbox(page: PageSize, bbox: BBox) -> NormRect:
    x0 = max(0.0, bbox.x0)
    y0 = max(0.0, bbox.y0)
    x1 = max(x0, bbox.x1)
    y1 = max(y0, bbox.y1)
    page_width = max(1.0, page.width)
    page_height = max(1.0, page.height)
    return NormRect(
        round(min(1.0, x0 / page_width), DECIMALS),
        round(min(1.0, y0 / page_height), DECIMALS),
        round(min(1.0, (x1 - x0) / page_width), DECIMALS),
        round(min(1.0, (y1 - y0) / page_height), DECIMALS),
    )


def derive(page: PageSize, bbox: BBox, apply_clamp: bool = True) -> NormRect:
    pipeline_rect = pymupdf_normalize_bbox(page, bbox)
    if apply_clamp:
        return clamp_norm_rect(pipeline_rect)
    return pipeline_rect


def rect_dict(rect: NormRect) -> dict[str, float]:
    return {
        "x": round(rect.x, DECIMALS),
        "y": round(rect.y, DECIMALS),
        "width": round(rect.width, DECIMALS),
        "height": round(rect.height, DECIMALS),
    }


def generate_fixtures() -> None:
    cases = [
        ("sample-transformer-page3", PageSize(1000, 2000), BBox(120, 340, 620, 520), True),
        ("letter-portrait-sentence", PageSize(612, 792), BBox(72, 96, 540, 118), True),
        ("a4-portrait-sentence", PageSize(595.28, 841.89), BBox(56.7, 113.4, 538.58, 141.75), True),
        ("wide-landscape-table", PageSize(792, 612), BBox(48, 72, 744, 312), True),
        ("union-multiline-wrap", PageSize(612, 792), BBox(72, 420, 540, 468), True),
        ("edge-clamp-negative-origin", PageSize(612, 792), BBox(-4, 88, 300, 112), True),
        ("edge-clamp-overflow", PageSize(612, 792), BBox(500, 700, 640, 820), True),
        ("tiny-bbox-superscript", PageSize(612, 792), BBox(410.5, 205.2, 418.1, 212.8), True),
        ("inverted-bbox-order", PageSize(612, 792), BBox(420, 300, 120, 340), True),
        ("four-decimal-round-up", PageSize(1000, 1000), BBox(333.3335, 666.6667, 777.7778, 888.8889), True),
        ("four-decimal-round-down", PageSize(1000, 1000), BBox(111.11114, 222.22224, 333.33334, 444.44444), True),
        ("full-width-margin", PageSize(612, 792), BBox(36, 600, 576, 630), True),
        ("figure-cluster-drawing", PageSize(612, 792), BBox(108, 240, 504, 480), True),
        ("table-lines-strict", PageSize(612, 792), BBox(90, 520, 522, 680), True),
        ("footnote-marker", PageSize(612, 792), BBox(96, 740, 128, 756), True),
    ]

    fixtures_dir = ROOT / "coord_diff" / "fixtures"
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    for case_id, page, bbox, apply_clamp in cases:
        expected = derive(page, bbox, apply_clamp)
        payload = {
            "case_id": case_id,
            "page": {"width": page.width, "height": page.height},
            "pymupdf_bbox": {"x0": bbox.x0, "y0": bbox.y0, "x1": bbox.x1, "y1": bbox.y1},
            "frontend_norm_rect": rect_dict(expected),
            "apply_frontend_clamp": apply_clamp,
        }
        path = fixtures_dir / f"{case_id}.json"
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    legacy = fixtures_dir / "sample_fixture.json"
    if legacy.exists():
        legacy.unlink()


def generate_labeled_pairs() -> None:
    out = ROOT / "citation_benchmark" / "labeled_pairs.sample.csv"
    rows: list[dict[str, str | int | float]] = []
    for index in range(1, 221):
        seed = hashlib.sha256(f"pair-{index}".encode("utf-8")).hexdigest()
        label = 1 if int(seed[:2], 16) % 100 < 55 else 0
        base = (int(seed[2:6], 16) % 1000) / 1000.0
        score = round(0.86 + base * 0.13, 4) if label == 1 else round(0.05 + base * 0.79, 4)
        rows.append(
            {
                "pair_id": f"p{index:03d}",
                "source_id": f"src-{int(seed[6:10], 16) % 900 + 100:03d}",
                "target_id": f"tgt-{int(seed[10:14], 16) % 900 + 100:03d}",
                "label": label,
                "score": score,
            }
        )

    with out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["pair_id", "source_id", "target_id", "label", "score"])
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    generate_fixtures()
    generate_labeled_pairs()
    print("generated coord fixtures and labeled_pairs.sample.csv")


if __name__ == "__main__":
    main()
