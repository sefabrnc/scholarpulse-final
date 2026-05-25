#!/usr/bin/env python3
"""Citation benchmark precision gate for labeled source-target pairs."""

from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class BenchmarkRow:
    pair_id: str
    source_id: str
    target_id: str
    label: int
    score: float


@dataclass(frozen=True)
class ThresholdMetrics:
    threshold: float
    tp: int
    fp: int
    fn: int
    tn: int
    precision: float
    recall: float
    f1: float


def parse_label(value: str) -> int:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "pos", "positive"}:
        return 1
    if normalized in {"0", "false", "no", "n", "neg", "negative"}:
        return 0
    raise ValueError(f"invalid label value: {value}")


def safe_div(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return numerator / denominator


def compute_metrics(rows: list[BenchmarkRow], threshold: float) -> ThresholdMetrics:
    tp = fp = fn = tn = 0
    for row in rows:
        predicted_positive = row.score >= threshold
        if predicted_positive and row.label == 1:
            tp += 1
        elif predicted_positive and row.label == 0:
            fp += 1
        elif not predicted_positive and row.label == 1:
            fn += 1
        else:
            tn += 1

    precision = safe_div(tp, tp + fp)
    recall = safe_div(tp, tp + fn)
    f1 = safe_div(2 * precision * recall, precision + recall)
    return ThresholdMetrics(
        threshold=threshold,
        tp=tp,
        fp=fp,
        fn=fn,
        tn=tn,
        precision=precision,
        recall=recall,
        f1=f1,
    )


def load_rows(path: Path) -> list[BenchmarkRow]:
    rows: list[BenchmarkRow] = []
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for raw in reader:
                row = {k: (v or "") for k, v in raw.items()}
                rows.append(_parse_benchmark_row(row))
        return rows

    if path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise ValueError("json benchmark must be an array")
        for item in payload:
            if not isinstance(item, dict):
                raise ValueError("json benchmark entries must be objects")
            row = {str(key): str(value) for key, value in item.items()}
            rows.append(_parse_benchmark_row(row))
        return rows

    raise ValueError("unsupported file extension; use csv or json")


def _parse_benchmark_row(row: dict[str, str]) -> BenchmarkRow:
    required = ("label", "score")
    for field in required:
        if field not in row:
            raise ValueError(f"each row requires {field} field")
    pair_id = row.get("pair_id") or row.get("id") or ""
    source_id = row.get("source_id") or row.get("source") or ""
    target_id = row.get("target_id") or row.get("target") or ""
    return BenchmarkRow(
        pair_id=pair_id,
        source_id=source_id,
        target_id=target_id,
        label=parse_label(row["label"]),
        score=float(row["score"]),
    )


def find_best_threshold(rows: list[BenchmarkRow], min_precision: float) -> ThresholdMetrics | None:
    if not rows:
        return None

    scores = sorted({row.score for row in rows})
    candidate_thresholds = [0.0] + scores + [min(1.0, scores[-1] + 0.0001)]
    best: ThresholdMetrics | None = None
    for threshold in candidate_thresholds:
        metrics = compute_metrics(rows, threshold)
        if metrics.precision < min_precision:
            continue
        if best is None or metrics.recall > best.recall or (
            math.isclose(metrics.recall, best.recall) and metrics.f1 > best.f1
        ):
            best = metrics
    return best


def is_synthetic_benchmark(path: Path) -> bool:
    name = path.name.lower()
    return "sample" in name or name.endswith(".template.csv")


def main() -> int:
    parser = argparse.ArgumentParser(description="Compute citation precision from labeled pairs.")
    parser.add_argument(
        "--input",
        default=str(Path(__file__).parent / "labeled_pairs.sample.csv"),
        help="Path to labeled benchmark data (.csv or .json)",
    )
    parser.add_argument("--threshold", type=float, default=0.87, help="Prediction threshold for positive class")
    parser.add_argument("--min-precision", type=float, default=0.95, help="Quality gate precision target")
    parser.add_argument(
        "--require-zero-fp",
        action="store_true",
        help="Fail gate if any false positives are observed",
    )
    parser.add_argument(
        "--sweep-thresholds",
        action="store_true",
        help="Print best threshold meeting min precision (max recall tie-break by f1)",
    )
    parser.add_argument(
        "--allow-synthetic",
        action="store_true",
        help="Allow gate PASS on generated sample CSV (not for launch sign-off)",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        help="Emit machine-readable summary JSON on stdout",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    rows = load_rows(input_path)
    synthetic = is_synthetic_benchmark(input_path)
    if synthetic:
        print(
            "WARNING: synthetic benchmark detected "
            f"({input_path.name}). Scores are not from the production pipeline. "
            "Use labeled_pairs.template.csv and real CE scores before launch."
        )
        if not args.allow_synthetic:
            print("gate=FAIL (synthetic benchmark blocked; pass --allow-synthetic for smoke only)")
            return 1
    metrics = compute_metrics(rows, args.threshold)
    positives = metrics.tp + metrics.fp
    gate_ok = metrics.precision >= args.min_precision and (not args.require_zero_fp or metrics.fp == 0)
    best = find_best_threshold(rows, args.min_precision) if args.sweep_thresholds else None

    summary = {
        "rows": len(rows),
        "threshold": args.threshold,
        "predicted_positive": positives,
        "tp": metrics.tp,
        "fp": metrics.fp,
        "fn": metrics.fn,
        "tn": metrics.tn,
        "precision": round(metrics.precision, 6),
        "recall": round(metrics.recall, 6),
        "f1": round(metrics.f1, 6),
        "target_precision": args.min_precision,
        "zero_fp_required": args.require_zero_fp,
        "gate": "PASS" if gate_ok else "FAIL",
        "synthetic_benchmark": synthetic,
        "allow_synthetic": args.allow_synthetic,
        "best_threshold": None if best is None else {
            "threshold": best.threshold,
            "precision": round(best.precision, 6),
            "recall": round(best.recall, 6),
            "f1": round(best.f1, 6),
            "tp": best.tp,
            "fp": best.fp,
            "fn": best.fn,
            "tn": best.tn,
        },
    }

    if args.json_output:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        print(f"rows={summary['rows']}")
        print(f"predicted_positive={summary['predicted_positive']}")
        print(f"tp={summary['tp']}")
        print(f"fp={summary['fp']}")
        print(f"fn={summary['fn']}")
        print(f"tn={summary['tn']}")
        print(f"precision={metrics.precision:.4f}")
        print(f"recall={metrics.recall:.4f}")
        print(f"f1={metrics.f1:.4f}")
        print(f"threshold={args.threshold:.4f}")
        print(f"target_precision={args.min_precision:.4f}")
        print(f"zero_fp_required={args.require_zero_fp}")
        if best is not None:
            print(
                "best_threshold="
                f"{best.threshold:.4f} precision={best.precision:.4f} "
                f"recall={best.recall:.4f} f1={best.f1:.4f} fp={best.fp}"
            )
        elif args.sweep_thresholds:
            print("best_threshold=none (no threshold met min precision)")
        print(f"gate={'PASS' if gate_ok else 'FAIL'}")

    return 0 if gate_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
