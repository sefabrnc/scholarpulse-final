#!/usr/bin/env python3
"""Validate real-PDF coord-diff manifest before pixel gate runs."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path


REQUIRED_FIELDS = ("case_id", "pdf_path", "page_number")


@dataclass(frozen=True)
class ManifestIssue:
    case_id: str
    level: str
    message: str


def load_manifest(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: manifest root must be an object")
    return payload


def validate_case(case: dict, repo_root: Path, check_pdf_readable: bool) -> list[ManifestIssue]:
    issues: list[ManifestIssue] = []
    case_id = str(case.get("case_id") or "unknown")

    for field in REQUIRED_FIELDS:
        if field not in case or case[field] in (None, ""):
            issues.append(ManifestIssue(case_id, "error", f"missing required field {field}"))

    pdf_path_raw = case.get("pdf_path")
    if not isinstance(pdf_path_raw, str) or not pdf_path_raw.strip():
        return issues

    pdf_path = Path(pdf_path_raw)
    if not pdf_path.is_absolute():
        pdf_path = repo_root / pdf_path

    if not pdf_path.is_file():
        issues.append(ManifestIssue(case_id, "error", f"pdf not found: {pdf_path}"))
        return issues

    page_number = case.get("page_number")
    if not isinstance(page_number, int) or page_number < 1:
        issues.append(ManifestIssue(case_id, "error", f"page_number must be >= 1, got {page_number!r}"))
        return issues

    size_bytes = pdf_path.stat().st_size
    if size_bytes == 0:
        issues.append(ManifestIssue(case_id, "error", f"pdf is empty: {pdf_path}"))
    elif size_bytes > 50 * 1024 * 1024:
        issues.append(ManifestIssue(case_id, "warn", f"pdf exceeds 50MB ({size_bytes} bytes): {pdf_path}"))

    if check_pdf_readable:
        try:
            import fitz  # PyMuPDF
        except ImportError:
            issues.append(
                ManifestIssue(case_id, "warn", "PyMuPDF not installed; skipping page count check (pip install pymupdf)")
            )
            return issues

        doc = fitz.open(pdf_path)
        try:
            if page_number > doc.page_count:
                issues.append(
                    ManifestIssue(
                        case_id,
                        "error",
                        f"page_number={page_number} exceeds pdf page_count={doc.page_count}",
                    )
                )
        finally:
            doc.close()

    hint = case.get("sentence_hint")
    if not isinstance(hint, str) or not hint.strip():
        issues.append(ManifestIssue(case_id, "warn", "sentence_hint missing (recommended for debugging misses)"))

    return issues


def validate_manifest(path: Path, repo_root: Path, check_pdf_readable: bool) -> tuple[list[dict], list[ManifestIssue]]:
    payload = load_manifest(path)
    cases = payload.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError(f"{path}: manifest requires non-empty cases[]")

    all_issues: list[ManifestIssue] = []
    seen_ids: set[str] = set()
    valid_cases: list[dict] = []

    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            all_issues.append(ManifestIssue(f"index-{index}", "error", "case entry must be an object"))
            continue
        case_id = str(case.get("case_id") or f"index-{index}")
        if case_id in seen_ids:
            all_issues.append(ManifestIssue(case_id, "error", "duplicate case_id"))
        seen_ids.add(case_id)
        case_issues = validate_case(case, repo_root, check_pdf_readable)
        all_issues.extend(case_issues)
        if not any(issue.level == "error" for issue in case_issues):
            valid_cases.append(case)

    return valid_cases, all_issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate pdf_cases manifest for coord-diff pixel gate.")
    parser.add_argument(
        "--manifest",
        default=str(Path(__file__).parent / "fixtures" / "pdf_cases.template.json"),
        help="Manifest JSON path (copy from pdf_cases.template.json)",
    )
    parser.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parents[2]),
        help="Repo root for resolving relative pdf_path values",
    )
    parser.add_argument(
        "--check-pdf",
        action="store_true",
        help="Open PDFs with PyMuPDF and verify page_number <= page_count",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        help="Emit machine-readable summary JSON",
    )
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    repo_root = Path(args.repo_root)
    try:
        valid_cases, issues = validate_manifest(manifest_path, repo_root, args.check_pdf)
    except ValueError as exc:
        print(f"gate=FAIL error={exc}")
        return 1

    errors = [issue for issue in issues if issue.level == "error"]
    warnings = [issue for issue in issues if issue.level == "warn"]
    gate_ok = len(errors) == 0 and len(valid_cases) > 0

    summary = {
        "manifest": str(manifest_path),
        "cases_total": len(valid_cases) + len([issue for issue in errors if issue.case_id.startswith("index-")]),
        "cases_valid": len(valid_cases),
        "errors": [{"case_id": issue.case_id, "message": issue.message} for issue in errors],
        "warnings": [{"case_id": issue.case_id, "message": issue.message} for issue in warnings],
        "gate": "PASS" if gate_ok else "FAIL",
    }

    if args.json_output:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        for issue in issues:
            prefix = "ERROR" if issue.level == "error" else "WARN"
            print(f"[{prefix}] {issue.case_id}: {issue.message}")
        print(
            f"Summary: valid={summary['cases_valid']} errors={len(errors)} "
            f"warnings={len(warnings)} gate={'PASS' if gate_ok else 'FAIL'}"
        )

    return 0 if gate_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
