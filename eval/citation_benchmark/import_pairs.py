#!/usr/bin/env python3
"""Merge pipeline CE scores into labeled_pairs.real.csv."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path

OUTPUT_COLUMNS = ("pair_id", "source_id", "target_id", "label", "score", "notes")
TEMPLATE_PATH = Path(__file__).parent / "labeled_pairs.template.csv"


@dataclass(frozen=True)
class ScoreRow:
    source_id: str
    target_id: str
    score: float
    pair_id: str = ""


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return [{key: (value or "") for key, value in row.items()} for row in reader]


def write_csv_rows(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in OUTPUT_COLUMNS})


def load_scores(path: Path) -> list[ScoreRow]:
    if path.suffix.lower() == ".csv":
        rows = read_csv_rows(path)
        return [_parse_score_row(row) for row in rows]
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return [_parse_score_row(item) for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        items = payload.get("edges") or payload.get("pairs") or payload.get("items")
        if isinstance(items, list):
            return [_parse_score_row(item) for item in items if isinstance(item, dict)]
    raise ValueError(f"{path}: expected csv/json with source_id, target_id, ce_score")


def _parse_score_row(raw: dict) -> ScoreRow:
    source_id = str(raw.get("source_id") or raw.get("source") or raw.get("from_node_id") or "").strip()
    target_id = str(raw.get("target_id") or raw.get("target") or raw.get("to_node_id") or "").strip()
    score_raw = raw.get("score") or raw.get("ce_score") or raw.get("ceScore") or raw.get("weight")
    if not source_id or not target_id or score_raw is None:
        raise ValueError("score row requires source_id, target_id, score/ce_score")
    pair_id = str(raw.get("pair_id") or raw.get("id") or "").strip()
    return ScoreRow(
        source_id=source_id,
        target_id=target_id,
        score=float(score_raw),
        pair_id=pair_id,
    )


def score_key(source_id: str, target_id: str) -> str:
    return f"{source_id}\t{target_id}"


def format_score(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")


def merge_scores(
    labels: list[dict[str, str]],
    scores: list[ScoreRow],
    fill_missing_labels: bool,
) -> tuple[list[dict[str, str]], dict[str, int]]:
    score_map = {score_key(row.source_id, row.target_id): row for row in scores}
    stats = {"updated": 0, "appended": 0, "missing_score": 0, "skipped_existing_label": 0}
    merged: list[dict[str, str]] = []
    seen_keys: set[str] = set()

    for row in labels:
        key = score_key(row["source_id"], row["target_id"])
        seen_keys.add(key)
        score_row = score_map.get(key)
        if score_row:
            row = dict(row)
            row["score"] = format_score(score_row.score)
            stats["updated"] += 1
        elif not row.get("score") or row["score"].startswith("<"):
            stats["missing_score"] += 1
        merged.append(row)

    next_index = len(merged) + 1
    for score_row in scores:
        key = score_key(score_row.source_id, score_row.target_id)
        if key in seen_keys:
            continue
        if not fill_missing_labels:
            continue
        pair_id = score_row.pair_id or f"import-{next_index:04d}"
        merged.append(
            {
                "pair_id": pair_id,
                "source_id": score_row.source_id,
                "target_id": score_row.target_id,
                "label": "",
                "score": format_score(score_row.score),
                "notes": "imported from pipeline; label pending admin review",
            }
        )
        stats["appended"] += 1
        next_index += 1

    return merged, stats


def validate_output(rows: list[dict[str, str]], min_rows: int) -> list[str]:
    errors: list[str] = []
    if len(rows) < min_rows:
        errors.append(f"row_count={len(rows)} below min_rows={min_rows}")
    seen_ids: set[str] = set()
    for row in rows:
        pair_id = row.get("pair_id", "")
        if not pair_id:
            errors.append("row missing pair_id")
            continue
        if pair_id in seen_ids:
            errors.append(f"duplicate pair_id={pair_id}")
        seen_ids.add(pair_id)
        label = row.get("label", "").strip()
        if label and label not in {"0", "1"}:
            errors.append(f"{pair_id}: invalid label={label}")
        score = row.get("score", "").strip()
        if not score or score.startswith("<"):
            errors.append(f"{pair_id}: missing pipeline score")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Import pipeline CE scores into labeled_pairs.real.csv")
    parser.add_argument(
        "--scores",
        required=True,
        help="Pipeline export (.csv/.json) with source_id, target_id, ce_score",
    )
    parser.add_argument(
        "--labels",
        default=str(Path(__file__).parent / "labeled_pairs.real.csv"),
        help="Existing labeled CSV to update (created from template if missing)",
    )
    parser.add_argument(
        "--from-template",
        action="store_true",
        help="Bootstrap labels file from labeled_pairs.template.csv when --labels is missing",
    )
    parser.add_argument(
        "--fill-missing",
        action="store_true",
        help="Append unlabeled rows for score pairs not present in labels CSV",
    )
    parser.add_argument(
        "--min-rows",
        type=int,
        default=0,
        help="Fail when output row count is below this threshold",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate merge without writing output",
    )
    args = parser.parse_args()

    labels_path = Path(args.labels)
    if labels_path.is_file():
        labels = read_csv_rows(labels_path)
    elif args.from_template:
        labels = read_csv_rows(TEMPLATE_PATH)
        labels = [row for row in labels if not row.get("pair_id", "").startswith("example-")]
    else:
        labels = []

    scores = load_scores(Path(args.scores))
    merged, stats = merge_scores(labels, scores, fill_missing_labels=args.fill_missing)
    errors = validate_output(merged, args.min_rows)

    print(f"scores={len(scores)} labels_in={len(labels)} labels_out={len(merged)}")
    print(
        "stats="
        f"updated={stats['updated']} appended={stats['appended']} "
        f"missing_score={stats['missing_score']}"
    )
    if errors:
        print("validation_errors:")
        for error in errors:
            print(f"  - {error}")
        return 1

    if args.dry_run:
        print("dry-run: no file written")
        return 0

    write_csv_rows(labels_path, merged)
    print(f"wrote {labels_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
