#!/usr/bin/env python3
"""Interactive admin labeling for citation benchmark pairs."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path

OUTPUT_COLUMNS = ("pair_id", "source_id", "target_id", "label", "score", "notes")
LABEL_HELP = "1=yes (valid cite), 0=no (false positive), s=skip, q=quit"


@dataclass(frozen=True)
class Candidate:
    pair_id: str
    source_id: str
    target_id: str
    score: float
    context: str


def load_existing_labels(path: Path) -> dict[str, dict[str, str]]:
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return {row["pair_id"]: row for row in reader if row.get("pair_id")}


def load_candidates(path: Path) -> list[Candidate]:
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            return [_parse_candidate(row) for row in reader]
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return [_parse_candidate(item) for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        items = payload.get("pairs") or payload.get("candidates") or payload.get("items")
        if isinstance(items, list):
            return [_parse_candidate(item) for item in items if isinstance(item, dict)]
    raise ValueError(f"{path}: expected csv rows or json array/object with pairs[]")


def _parse_candidate(raw: dict) -> Candidate:
    pair_id = str(raw.get("pair_id") or raw.get("id") or "").strip()
    source_id = str(raw.get("source_id") or raw.get("source") or "").strip()
    target_id = str(raw.get("target_id") or raw.get("target") or "").strip()
    if not pair_id or not source_id or not target_id:
        raise ValueError("each candidate requires pair_id, source_id, target_id")
    score_raw = raw.get("score") or raw.get("ce_score") or raw.get("ceScore") or "0"
    context = str(raw.get("context") or raw.get("notes") or raw.get("hint") or "").strip()
    return Candidate(
        pair_id=pair_id,
        source_id=source_id,
        target_id=target_id,
        score=float(score_raw),
        context=context,
    )


def write_labels(path: Path, rows: dict[str, dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(rows.values(), key=lambda row: row["pair_id"])
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        for row in ordered:
            writer.writerow({column: row.get(column, "") for column in OUTPUT_COLUMNS})


def prompt_label(candidate: Candidate) -> tuple[str | None, str]:
    print("\n---")
    print(f"pair_id={candidate.pair_id}")
    print(f"source_id={candidate.source_id}")
    print(f"target_id={candidate.target_id}")
    print(f"pipeline_score={candidate.score:.4f}")
    if candidate.context:
        print(f"context={candidate.context}")
    while True:
        answer = input(f"label ({LABEL_HELP}): ").strip().lower()
        if answer in {"q", "quit", "exit"}:
            return None, ""
        if answer in {"s", "skip", ""}:
            return "skip", ""
        if answer in {"1", "y", "yes", "pos", "positive"}:
            notes = input("notes (optional): ").strip()
            return "1", notes
        if answer in {"0", "n", "no", "neg", "negative"}:
            notes = input("notes (optional): ").strip()
            return "0", notes
        print(f"Invalid input. Use {LABEL_HELP}.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Admin labeling CLI for citation benchmark pairs.")
    parser.add_argument(
        "--candidates",
        required=True,
        help="Candidate pairs (.csv or .json) exported from D1/Colab spot-check queue",
    )
    parser.add_argument(
        "--output",
        default=str(Path(__file__).parent / "labeled_pairs.real.csv"),
        help="Output labeled CSV (merged incrementally)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip pair_ids already present in output CSV",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print candidates without writing output",
    )
    args = parser.parse_args()

    candidates_path = Path(args.candidates)
    output_path = Path(args.output)
    existing = load_existing_labels(output_path)
    candidates = load_candidates(candidates_path)

    pending = [
        candidate
        for candidate in candidates
        if not (args.resume and candidate.pair_id in existing)
    ]
    print(f"candidates={len(candidates)} pending={len(pending)} existing_labels={len(existing)}")

    labeled_count = 0
    for candidate in pending:
        if args.dry_run:
            print(
                f"[dry-run] {candidate.pair_id} "
                f"{candidate.source_id}->{candidate.target_id} score={candidate.score:.4f}"
            )
            continue

        decision, notes = prompt_label(candidate)
        if decision is None:
            print("Stopping on user request.")
            break
        if decision == "skip":
            continue

        existing[candidate.pair_id] = {
            "pair_id": candidate.pair_id,
            "source_id": candidate.source_id,
            "target_id": candidate.target_id,
            "label": decision,
            "score": f"{candidate.score:.6f}".rstrip("0").rstrip("."),
            "notes": notes,
        }
        labeled_count += 1
        write_labels(output_path, existing)
        print(f"saved {candidate.pair_id} -> label={decision} ({len(existing)} total rows)")

    if not args.dry_run and labeled_count == 0 and len(pending) == 0:
        print("Nothing to label.")
    elif not args.dry_run:
        print(f"output={output_path} rows={len(existing)} newly_labeled={labeled_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
