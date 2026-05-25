# Eval Harnesses

This directory contains fixture-based quality harnesses for Phase-1 gates.

## Asset Generator

Path: `eval/_generate_eval_assets.py`

Regenerates coord diff fixtures and the citation benchmark sample CSV with deterministic expected values.

```bash
python eval/_generate_eval_assets.py
```

## 1) Coord Diff Harness

Path: `eval/coord_diff/coord_diff_harness.py`

Purpose:

- Compare PyMuPDF bbox conversion to frontend `normRect` representation.
- Mirror Colab pass0 normalization and web `clampNormRect` / viewport conversion.
- Gate by max per-dimension viewport pixel delta (`<= 1px` target).

Input:

- Fixture JSON files in `eval/coord_diff/fixtures/` (15 cases).

Run:

```bash
python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0
```

## 2) Citation Precision Harness

Path: `eval/citation_benchmark/evaluate_precision.py`

Supporting tools (Workstream D):

| Script | Purpose |
|---|---|
| `admin_label.py` | Interactive CLI for admin spot-check labeling |
| `import_pairs.py` | Merge pipeline CE scores into `labeled_pairs.real.csv` |
| `candidates.template.json` | Export template for labeling queue |
| `CI_GATE.md` | CI wiring notes + exit codes |

Purpose:

- Run labeled source-target pair benchmark.
- Compute precision/recall/F1 at configurable threshold.
- Enforce minimum precision and optional zero false-positive gate.
- Optional threshold sweep for max recall at precision target.

Input:

- CSV or JSON benchmark file with `label` and `score` fields.
- Starter sample: `eval/citation_benchmark/labeled_pairs.sample.csv` (220 rows)

Run:

```bash
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.sample.csv \
  --threshold 0.85 \
  --min-precision 0.95 \
  --require-zero-fp \
  --sweep-thresholds
```

JSON output for CI:

```bash
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.sample.csv \
  --threshold 0.85 \
  --min-precision 0.95 \
  --require-zero-fp \
  --json-output
```

## Notes

- Keep files ASCII-only for reproducible diffing across toolchains.
- Replace sample CSV with real labeled pairs from admin spot-checks before launch sign-off.
- Real label template: `eval/citation_benchmark/labeled_pairs.template.csv`
- Synthetic smoke CSV (`labeled_pairs.sample.csv`) is blocked by default; pass `--allow-synthetic` for local smoke only.

## Real citation labels (`labeled_pairs.template.csv`)

Template columns:

| Column | Required | Description |
|---|---|---|
| `pair_id` | yes | Stable id (e.g. `admin-spot-042`) |
| `source_id` | yes | Citing `sentence_id` (cite_nodes PK) |
| `target_id` | yes | Cited `sentence_id` |
| `label` | yes | `1` = valid edge, `0` = false positive |
| `score` | yes | Pipeline CE score (`ce_score` from bulk ingest) |
| `notes` | no | Admin rationale (wrong sentence, figure cite, etc.) |

Workflow:

1. Copy template to a working file (never commit secrets/PII in notes):

```bash
cp eval/citation_benchmark/labeled_pairs.template.csv \
   eval/citation_benchmark/labeled_pairs.real.csv
```

2. Label 200+ pairs from admin spot-checks (mix of positives/negatives, include figure/table cites).
3. Fill `score` from pipeline output — export from Colab stage or D1:

```sql
SELECT source_id, target_id, ce_score
FROM cite_edges
WHERE id IN (...);
```

4. Run the production gate (no `--allow-synthetic`):

```bash
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.real.csv \
  --threshold 0.85 \
  --min-precision 0.92 \
  --require-zero-fp \
  --sweep-thresholds \
  --json-output
```

Pass criteria: `gate=PASS`, precision >= 0.92 at threshold 0.85 (launch target 0.95).

### Admin labeling workflow

```bash
# 1) Export candidates from D1/Colab (copy candidates.template.json shape)
cp eval/citation_benchmark/candidates.template.json eval/citation_benchmark/candidates.json

# 2) Merge pipeline CE scores into working labels file
python eval/citation_benchmark/import_pairs.py \
  --scores pipeline_scores.csv \
  --from-template \
  --fill-missing

# 3) Label interactively (resume-safe)
python eval/citation_benchmark/admin_label.py \
  --candidates eval/citation_benchmark/candidates.json \
  --output eval/citation_benchmark/labeled_pairs.real.csv \
  --resume
```

See `eval/citation_benchmark/CI_GATE.md` for CI integration.

`evaluate_precision.py` rejects `*sample*` and `*.template.csv` unless `--allow-synthetic` is set.

## Synthetic benchmark warning

`evaluate_precision.py` detects generated sample files (`*sample*` or `*.template.csv`) and fails the gate unless `--allow-synthetic` is set. Production sign-off requires pipeline-generated CE scores in a new CSV copied from `labeled_pairs.template.csv`.

```bash
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.sample.csv \
  --threshold 0.87 \
  --min-precision 0.95 \
  --require-zero-fp \
  --allow-synthetic
```

## Real PDF coord-diff manifest (Phase 1.5)

Template: `eval/coord_diff/fixtures/pdf_cases.template.json`

Example workflow:

```bash
# 1) Copy manifest (gitignored working copy)
cp eval/coord_diff/fixtures/pdf_cases.template.json \
   eval/coord_diff/fixtures/pdf_cases.json

# 2) Download or copy 10 real PDFs into eval/coord_diff/pdfs/
#    Paths in pdf_cases.json are repo-relative, e.g.:
#    eval/coord_diff/pdfs/attention_is_all_you_need_p3.pdf

# 3) Optional: trim to one page per case with PyMuPDF before commit to local disk only

# 4) Run pixel gate (<= 1px viewport delta)
python eval/coord_diff/coord_diff_harness.py \
  --pdf-manifest eval/coord_diff/fixtures/pdf_cases.json \
  --max-diff-px 1.0
```

Manifest case fields:

| Field | Description |
|---|---|
| `case_id` | Stable slug for CI logs |
| `pdf_path` | Repo-relative path under `eval/coord_diff/pdfs/` |
| `page_number` | 1-based page to extract |
| `sentence_hint` | Human label for debugging misses |

Missing PDFs report as `[MISSING]` — fixture JSON gate (15 cases) still passes without local PDFs. Phase 1.5 sign-off requires all 10 manifest cases PASS or documented known issues.

### Manifest validator (pre-flight)

```bash
# Structure + file existence (no PyMuPDF required)
python eval/coord_diff/validate_manifest.py \
  --manifest eval/coord_diff/fixtures/pdf_cases.template.json

# Include page_count check (requires pymupdf)
python eval/coord_diff/validate_manifest.py \
  --manifest eval/coord_diff/fixtures/pdf_cases.json \
  --check-pdf \
  --json-output
```
