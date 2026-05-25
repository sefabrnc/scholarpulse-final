#!/usr/bin/env python3
"""Fixture-based coord diff harness (PyMuPDF bbox vs frontend normRect)."""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


EPSILON = 0.0001
DECIMALS = 4


@dataclass(frozen=True)
class PageSize:
    width: float
    height: float


@dataclass(frozen=True)
class BBox:
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass(frozen=True)
class NormRect:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class CoordFixture:
    case_id: str
    page: PageSize
    bbox: BBox
    expected: NormRect
    apply_frontend_clamp: bool = True


def _read_float(record: dict, key: str) -> float:
    value = record.get(key)
    if not isinstance(value, (int, float)):
        raise ValueError(f"missing numeric field: {key}")
    return float(value)


def _read_norm_rect(record: dict) -> NormRect:
    width = record.get("width", record.get("w"))
    height = record.get("height", record.get("h"))
    if not isinstance(width, (int, float)) or not isinstance(height, (int, float)):
        raise ValueError("frontend_norm_rect requires width/height (or w/h)")
    return NormRect(
        x=_read_float(record, "x"),
        y=_read_float(record, "y"),
        width=float(width),
        height=float(height),
    )


def clamp01(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return min(1.0, max(0.0, value))


def clamp_norm_rect(rect: NormRect) -> NormRect:
    """Mirror apps/web/utils/pdf/normRect.ts::clampNormRect."""
    x0 = clamp01(rect.x)
    y0 = clamp01(rect.y)
    x1 = clamp01(rect.x + rect.width)
    y1 = clamp01(rect.y + rect.height)
    return NormRect(
        x=min(x0, x1),
        y=min(y0, y1),
        width=max(EPSILON, abs(x1 - x0)),
        height=max(EPSILON, abs(y1 - y0)),
    )


def pymupdf_normalize_bbox(page: PageSize, bbox: BBox) -> NormRect:
    """Mirror colab/pipeline/stages/pass0_preflight_extract.py::_normalize_bbox."""
    x0 = max(0.0, bbox.x0)
    y0 = max(0.0, bbox.y0)
    x1 = max(x0, bbox.x1)
    y1 = max(y0, bbox.y1)
    page_width = max(1.0, page.width)
    page_height = max(1.0, page.height)
    return NormRect(
        x=round(min(1.0, x0 / page_width), DECIMALS),
        y=round(min(1.0, y0 / page_height), DECIMALS),
        width=round(min(1.0, (x1 - x0) / page_width), DECIMALS),
        height=round(min(1.0, (y1 - y0) / page_height), DECIMALS),
    )


def derive_norm_rect(page: PageSize, bbox: BBox, apply_frontend_clamp: bool = True) -> NormRect:
    pipeline_rect = pymupdf_normalize_bbox(page, bbox)
    if apply_frontend_clamp:
        return clamp_norm_rect(pipeline_rect)
    return pipeline_rect


def norm_rect_to_viewport_rect(rect: NormRect, page: PageSize) -> dict[str, float]:
    """Mirror apps/web/utils/pdf/normRect.ts::normRectToViewportRect."""
    clamped = clamp_norm_rect(rect)
    return {
        "x": clamped.x * page.width,
        "y": clamped.y * page.height,
        "width": max(1.0, clamped.width * page.width),
        "height": max(1.0, clamped.height * page.height),
    }


def diff_in_pixels(page: PageSize, expected: NormRect, actual: NormRect) -> dict[str, float]:
    expected_vp = norm_rect_to_viewport_rect(expected, page)
    actual_vp = norm_rect_to_viewport_rect(actual, page)
    return {
        "x_px": abs(expected_vp["x"] - actual_vp["x"]),
        "y_px": abs(expected_vp["y"] - actual_vp["y"]),
        "w_px": abs(expected_vp["width"] - actual_vp["width"]),
        "h_px": abs(expected_vp["height"] - actual_vp["height"]),
    }


def load_fixture(path: Path) -> CoordFixture:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: fixture must be an object")

    case_id = payload.get("case_id")
    if not isinstance(case_id, str) or not case_id.strip():
        raise ValueError(f"{path}: case_id must be a non-empty string")

    page_payload = payload.get("page")
    bbox_payload = payload.get("pymupdf_bbox")
    expected_payload = payload.get("frontend_norm_rect")
    if not isinstance(page_payload, dict) or not isinstance(bbox_payload, dict) or not isinstance(expected_payload, dict):
        raise ValueError(f"{path}: page, pymupdf_bbox and frontend_norm_rect are required")

    apply_frontend_clamp = payload.get("apply_frontend_clamp", True)
    if not isinstance(apply_frontend_clamp, bool):
        raise ValueError(f"{path}: apply_frontend_clamp must be boolean when present")

    page = PageSize(
        width=_read_float(page_payload, "width"),
        height=_read_float(page_payload, "height"),
    )
    bbox = BBox(
        x0=_read_float(bbox_payload, "x0"),
        y0=_read_float(bbox_payload, "y0"),
        x1=_read_float(bbox_payload, "x1"),
        y1=_read_float(bbox_payload, "y1"),
    )
    expected = _read_norm_rect(expected_payload)
    return CoordFixture(
        case_id=case_id,
        page=page,
        bbox=bbox,
        expected=expected,
        apply_frontend_clamp=apply_frontend_clamp,
    )


def iter_fixture_paths(fixtures_dir: Path) -> Iterable[Path]:
    return sorted(
        path
        for path in fixtures_dir.glob("*.json")
        if path.is_file() and not path.name.endswith(".template.json")
    )


def load_pdf_manifest(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: pdf manifest must be an object")
    cases = payload.get("cases")
    if not isinstance(cases, list):
        raise ValueError(f"{path}: pdf manifest requires cases[]")
    return [case for case in cases if isinstance(case, dict)]


def run_pdf_manifest(manifest_path: Path, max_diff_px: float) -> int:
    cases = load_pdf_manifest(manifest_path)
    if not cases:
        print("No pdf manifest cases found.")
        return 1

    missing = 0
    skipped = 0
    for case in cases:
        case_id = str(case.get("case_id", "unknown"))
        pdf_path_raw = case.get("pdf_path")
        if not isinstance(pdf_path_raw, str) or not pdf_path_raw.strip():
            print(f"[SKIP] {case_id} missing pdf_path")
            skipped += 1
            continue
        pdf_path = Path(pdf_path_raw)
        if not pdf_path.is_file():
            print(f"[MISSING] {case_id} pdf not found: {pdf_path}")
            missing += 1
            continue
        print(
            f"[PENDING] {case_id} pdf={pdf_path} "
            f"(real pixel diff harness not wired; gate target <= {max_diff_px}px)"
        )

    print(
        f"PDF manifest summary: total={len(cases)} missing={missing} "
        f"skipped={skipped} pending_real_diff={len(cases) - missing - skipped}"
    )
    return 1 if missing > 0 else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run bbox->normRect coord diff harness.")
    parser.add_argument(
        "--fixtures-dir",
        default=str(Path(__file__).parent / "fixtures"),
        help="Directory containing fixture json files",
    )
    parser.add_argument("--max-diff-px", type=float, default=1.0, help="Maximum allowed per-dimension pixel diff")
    parser.add_argument(
        "--pdf-manifest",
        default="",
        help="Optional real-PDF manifest JSON (copy from fixtures/pdf_cases.template.json)",
    )
    args = parser.parse_args()

    if args.pdf_manifest:
        return run_pdf_manifest(Path(args.pdf_manifest), args.max_diff_px)

    fixture_paths = list(iter_fixture_paths(Path(args.fixtures_dir)))
    if not fixture_paths:
        print("No fixture files found.")
        return 1

    failures = 0
    for fixture_path in fixture_paths:
        fixture = load_fixture(fixture_path)
        actual = derive_norm_rect(fixture.page, fixture.bbox, fixture.apply_frontend_clamp)
        diff_px = diff_in_pixels(fixture.page, fixture.expected, actual)
        max_component_diff = max(diff_px.values())
        passed = max_component_diff <= args.max_diff_px
        status = "PASS" if passed else "FAIL"
        print(
            f"[{status}] {fixture.case_id} max_diff_px={max_component_diff:.4f} "
            f"(x={diff_px['x_px']:.4f}, y={diff_px['y_px']:.4f}, "
            f"w={diff_px['w_px']:.4f}, h={diff_px['h_px']:.4f})"
        )
        if not passed:
            failures += 1

    total = len(fixture_paths)
    passed_total = total - failures
    print(f"Summary: {passed_total}/{total} passed (gate <= {args.max_diff_px}px)")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
