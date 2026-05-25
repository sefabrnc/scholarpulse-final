# Citation Benchmark CI Gate

Production sign-off requires **real pipeline CE scores** and **admin labels** — not the synthetic sample CSV.

## Required checks (ingest / cite pipeline PRs)

```bash
# 1) Fixture coord gate (fast, no GPU)
python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0

# 2) Real-label precision gate (blocked until labeled_pairs.real.csv exists)
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.real.csv \
  --threshold 0.85 \
  --min-precision 0.92 \
  --require-zero-fp \
  --sweep-thresholds \
  --json-output
```

## Smoke-only (local dev, not launch sign-off)

```bash
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.sample.csv \
  --threshold 0.87 \
  --min-precision 0.95 \
  --require-zero-fp \
  --allow-synthetic \
  --json-output
```

## Labeling workflow (before real gate passes)

1. Export candidate pairs + CE scores from Colab bulk ingest or D1 (`cite_edges`).
2. Merge scores: `python eval/citation_benchmark/import_pairs.py --scores pipeline_scores.csv --from-template --fill-missing`
3. Label interactively: `python eval/citation_benchmark/admin_label.py --candidates candidates.json --resume`
4. Re-run import if scores refresh: `python eval/citation_benchmark/import_pairs.py --scores pipeline_scores.csv --labels labeled_pairs.real.csv`
5. Gate: `evaluate_precision.py` on `labeled_pairs.real.csv` (no `--allow-synthetic`).

## CI artifact

Store `--json-output` from step 2 as a build artifact. Fail the job when:

- `gate` != `PASS`
- `synthetic_benchmark` == `true` (unless job is explicitly `eval-smoke`)
- `rows` < 200 for production release branches

## GitHub Actions sketch

```yaml
- name: Coord diff fixtures
  run: python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0

- name: Citation eval smoke
  run: |
    python eval/citation_benchmark/evaluate_precision.py \
      --input eval/citation_benchmark/labeled_pairs.sample.csv \
      --threshold 0.87 --min-precision 0.95 --require-zero-fp \
      --allow-synthetic --json-output > citation-eval-smoke.json

- name: Citation eval production gate
  if: hashFiles('eval/citation_benchmark/labeled_pairs.real.csv') != ''
  run: |
    python eval/citation_benchmark/evaluate_precision.py \
      --input eval/citation_benchmark/labeled_pairs.real.csv \
      --threshold 0.85 --min-precision 0.92 --require-zero-fp \
      --sweep-thresholds --json-output > citation-eval-prod.json
```

## Exit codes

| Script | 0 | 1 |
|---|---|---|
| `evaluate_precision.py` | gate PASS | gate FAIL or synthetic blocked |
| `import_pairs.py` | merge OK | validation errors |
| `admin_label.py` | completed session | argparse / parse error |
