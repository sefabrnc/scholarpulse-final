# Quality Gates and Ops Checks

This document defines minimal quality gates for the quality/eval/ops stream.

Ar-Ge reference (2026-05-25): [`docs/ARGE_FINAL_2026.md`](./ARGE_FINAL_2026.md) | [`docs/ARGE_RAPORU_2026.md`](./ARGE_RAPORU_2026.md) | [`docs/ARGE_GAP_MATRIX_2026.md`](./ARGE_GAP_MATRIX_2026.md) | [`docs/ARGE_IMPLEMENT_QUEUE.md`](./ARGE_IMPLEMENT_QUEUE.md)

## Gates

1. Coord diff gate (`coord-diff-test`)
   - Harness: `eval/coord_diff/coord_diff_harness.py`
   - Fixtures: `eval/coord_diff/fixtures/*.json` (15 cases: letter/A4/landscape, union bbox, clamp edges, 4-decimal rounding)
   - Real PDF manifest template: `eval/coord_diff/fixtures/pdf_cases.template.json` (10 placeholder paths, Phase 1.5)
   - Manifest validator: `eval/coord_diff/validate_manifest.py` (structure + file existence pre-flight)
   - Logic mirrors:
     - Colab `pass0_preflight_extract._normalize_bbox` (4-decimal norm_x/y/w/h)
     - Web `apps/web/utils/pdf/normRect.ts` (`clampNormRect`, `normRectToViewportRect`)
   - Pass condition: viewport pixel diff per dimension <= `1px`
2. Citation quality gate (`cite-quality-eval`)
   - Harness: `eval/citation_benchmark/evaluate_precision.py`
   - Sample dataset: `eval/citation_benchmark/labeled_pairs.sample.csv` (220 labeled pairs, **synthetic scores**)
   - Real label template: `eval/citation_benchmark/labeled_pairs.template.csv`
   - Admin labeling: `eval/citation_benchmark/admin_label.py`
   - Score import: `eval/citation_benchmark/import_pairs.py`
   - CI notes: `eval/citation_benchmark/CI_GATE.md`
   - Pass condition: precision >= `0.95` at configured threshold on **pipeline-generated** scores
   - Synthetic smoke: requires `--allow-synthetic` (blocked by default per Ar-Ge R2)
   - Strict mode: `--require-zero-fp` (no false positives allowed)
3. Vector metadata gate (bulk ingest)
   - Worker rejects forbidden metadata keys (`text`, `sentence`, `abstract`, etc.)
   - Allowed keys: `doi`, `page`, `sentence_id`, `kind`, `stage`, `year`, `citation_count`, `doi_prefix`
   - Colab pass1 uses `colab/pipeline/policies/vector_metadata.py`
4. Observability gate (`observability-stack`, test/metrics scope)
   - Helper module: `apps/api/src/observability.ts`
   - Setup notes: `docs/observability-stack.md` (Logpush, Analytics Engine, metrics summary)
   - Internal endpoint: `GET /api/internal/metrics/summary?top_paths=20` (Bearer `INTERNAL_API_TOKEN`)
   - Required fields on request completion metric:
     - `metric_name`
     - `metric_kind`
     - `metric_unit`
     - `method`
     - `path`
     - `status`
     - `status_class`
     - `duration_ms`
   - Trace behavior:
     - Respect incoming `x-trace-id` when valid
     - Generate deterministic fallback trace id when missing/invalid
     - Return `x-trace-id` and `x-request-duration-ms` response headers

## Run Commands

From repo root (`scholarpulse-final/`):

```bash
# Regenerate fixture expected values + sample benchmark rows (deterministic)
python eval/_generate_eval_assets.py

# Coord diff gate (<= 1px viewport delta)
python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0

# PDF manifest pre-flight (expects local PDFs when copied from template)
python eval/coord_diff/validate_manifest.py \
  --manifest eval/coord_diff/fixtures/pdf_cases.template.json

# Citation precision gate (default threshold 0.87, target precision 0.95)
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.sample.csv \
  --threshold 0.87 \
  --min-precision 0.95 \
  --require-zero-fp \
  --allow-synthetic \
  --sweep-thresholds

# Real-label gate (after admin labeling + pipeline scores)
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.real.csv \
  --threshold 0.87 \
  --min-precision 0.95 \
  --require-zero-fp \
  --sweep-thresholds

# Machine-readable gate summary (CI artifact friendly)
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.sample.csv \
  --threshold 0.87 \
  --min-precision 0.95 \
  --require-zero-fp \
  --allow-synthetic \
  --json-output

# API typecheck (separate observability gate)
pnpm --filter @scholarpulse/api typecheck
```

Expected smoke output (2026-05-24):

- Coord diff: `Summary: 15/15 passed (gate <= 1.0px)`
- Citation eval smoke: `gate=PASS` with `--allow-synthetic` on sample CSV at threshold `0.87` (not valid for launch sign-off)

## CI Suggestion

- Wire both python harnesses as required checks for ingest/cite pipeline PRs.
- Keep a tracked benchmark dataset (CSV/JSON) and fail CI on gate regression.
- Store `--json-output` from citation eval as a CI artifact for trend tracking.

## QC Notes (2026-05-25, final QC tur 5)

Generated: `2026-05-24T22:37:02.335Z` | Findings: 22 (0 errors, 21 bottlenecks, 1 logic risk)

- `quality-control-work`: Final QC tur 5 — errors 0, passedChecks 10. Fixes: AppNav `pathname` null guard; PwaRegister `.catch()` replaces `void` fire-and-forget; removed hybrid `pages/500.tsx`; `build.mjs` invokes `node next/dist/bin/next` (paths with spaces safe), win32 pre-clean + 5 retries.
- `standalone-web-sections`: Web typecheck+build green in QC runner after fixes above.
- `circuit-breaker-dlq`: 21 bottleneck heuristics (nested map + unbounded SELECT). Review pagination on hot query paths.
- Python gates: `colab.pipeline.smoke_test` 10/10 OK; `coord_diff_harness` 15/15 PASS (gate <= 1.0px).

## QC Notes (2026-05-24, post-workstream rerun)

Generated: `2026-05-24T19:27:04.303Z` | Findings: 47 (12 errors, 20 bottlenecks, 15 logic risks)

- `observability-stack`: API typecheck and build pass after adding `DOM` lib to `apps/api/tsconfig.json` and `BufferSource` cast in `apps/api/src/ingest.ts`. FormData/File types resolve without TS2304.
- `quality-control-work`: QC runner Windows fixes shipped — `shell: true` for corepack spawn, Node regex fallback when `rg` is absent. Static pattern scans run via fallback; API checks green.
- `standalone-web-sections`: Web typecheck (code 2) and build (code 1) still fail in QC — real app errors, not runner spawn noise.
- `circuit-breaker-dlq`: 16 bottleneck heuristics in `apps/api/src/index.ts` (nested map + unbounded SELECT without LIMIT). Review pagination on hot query paths.
- `observability-stack` (perf): 1 nested-map heuristic in `apps/api/src/observability.ts:164`; ownership rule routes observability.ts to this todo.
