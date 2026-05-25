# ScholarPulse Operations Runbook

**Repo:** `scholarpulse-final`  
**Last updated:** 2026-05-25  
**Scope:** $0 stack — build stability, Colab GPU ingest, eval gates, QC rerun

Full setup (Colab + Cloudflare secrets, wrangler, Drive checkpoint): [`docs/KURULUM_REHBERI_COLAB_CF.md`](./KURULUM_REHBERI_COLAB_CF.md)

Quality gate details: [`docs/quality-gates.md`](./quality-gates.md)  
Observability: [`docs/observability-stack.md`](./observability-stack.md)

---

## 1. Quick health check (local)

```bash
# Repo root
node scripts/qc/run.js
corepack pnpm --filter @scholarpulse/api typecheck
corepack pnpm --filter @scholarpulse/web typecheck
corepack pnpm --filter @scholarpulse/api build
corepack pnpm --filter @scholarpulse/web build
```

**Pass criteria:** QC report `errors: 0`; api + web typecheck + build green.

---

## 2. Web build flake (Windows `.next`)

Symptom: intermittent `apps/web:build` or `typecheck` failure after a prior failed build; stale `.next` or `tsconfig.tsbuildinfo`.

**Fix (manual):**

```powershell
Remove-Item -Recurse -Force "apps/web/.next" -ErrorAction SilentlyContinue
Remove-Item -Force "apps/web/tsconfig.tsbuildinfo" -ErrorAction SilentlyContinue
corepack pnpm --filter @scholarpulse/web build
```

**3× stability gate (pre-release):**

```powershell
1..3 | ForEach-Object {
  Remove-Item -Recurse -Force "apps/web/.next" -ErrorAction SilentlyContinue
  corepack pnpm --filter @scholarpulse/web build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

`apps/web/scripts/prebuild.mjs` clears `tsconfig.tsbuildinfo` and copies the pdf.js worker before each build.

---

## 3. QC rerun

```bash
node scripts/qc/run.js
cat .qc/latest-report.json
```

| Check | Command |
|---|---|
| API typecheck + build | `corepack pnpm --filter @scholarpulse/api typecheck` / `build` |
| Web typecheck + build | `corepack pnpm --filter @scholarpulse/web typecheck` / `build` |
| Colab smoke (stub) | `python -m colab.pipeline.smoke_test` |
| Coord diff fixtures | `python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0` |
| Cite precision (real labels) | see §5 |

---

## 4. Colab GPU ingest (manual — launch P0)

**Not automated in CI.** Requires Colab Free T4 or Kaggle GPU session.

1. Open `colab/notebooks/ingest_pipeline.ipynb` (or run `ingest_pipeline_runner.py`).
2. Set env: `SP_INGEST_API_URL`, `SP_INGEST_TOKEN`, optional `SP_HEARTBEAT_URL`.
3. Run one PDF → verify bulk POST → D1 row with `algorithm_version=v1-colab-ml`.
4. Enable heartbeat while ingesting:

```bash
python colab/notebooks/ingest_pipeline_runner.py \
  --manifest eval/coord_diff/fixtures/manifest.json \
  --run-id demo-001 \
  --heartbeat-every 600
```

5. Verify Worker heartbeat:

```bash
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  "$WORKER_URL/api/internal/heartbeat" | jq .
```

Stale threshold: **30 minutes** (see `colab_heartbeat` in metrics summary).

---

## 5. Eval gates (manual — launch P0)

### 5.1 Citation precision (200+ real pairs)

```bash
# 1. Label pairs (human time ~4–8h)
python eval/citation_benchmark/admin_label.py \
  --candidates eval/citation_benchmark/candidates.template.json \
  --output eval/citation_benchmark/labeled_pairs.real.csv

# 2. Import Colab CE scores
python eval/citation_benchmark/import_pairs.py \
  --input eval/citation_benchmark/labeled_pairs.real.csv \
  --scores path/to/colab_scores.csv

# 3. Gate
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.real.csv \
  --threshold 0.85 \
  --min-precision 0.92 \
  --require-zero-fp
```

### 5.2 Coord diff (10 real PDFs)

1. Place OA PDFs in `eval/coord_diff/pdfs/`.
2. Fill `eval/coord_diff/pdf_cases.json` manifest.
3. Run:

```bash
python eval/coord_diff/validate_manifest.py
python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0
```

---

## 6. Internal ops endpoints

All require `Authorization: Bearer $INTERNAL_API_TOKEN`.

| Endpoint | Purpose |
|---|---|
| `GET /api/internal/metrics/summary` | HTTP metrics + PDF circuit breakers + Colab heartbeat stale flag |
| `POST /api/internal/heartbeat` | Colab runner liveness (JSON: `run_id`, `processed`, `platform`, `last_doi`) |
| `GET /api/internal/dlq/summary` | Unified DLQ (D1 `ingest_dlq`) + ingest queue snapshot |
| `GET /api/internal/dlq` | Paginated DLQ rows |
| `GET /api/internal/ingest-queue` | PDF uploads + pending bibs queue |

**DLQ summary example:**

```bash
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  "$WORKER_URL/api/internal/dlq/summary?recent_limit=10" | jq .
```

---

## 7. Public API source badges

When `SCHOLARPULSE_API_BASE_URL` is set but Worker is down, web public routes return OpenAlex data with:

```json
{ "source": "openalex_fallback", "workerUnavailable": true }
```

Desk timeline (`/api/cite/timeline`) returns **502** if Worker is configured but unreachable. Mock timeline is used only when `SCHOLARPULSE_API_BASE_URL` is unset (local demo).

---

## 8. Manual launch gates (do not skip)

| Gate | Status | Owner |
|---|---|---|
| Colab GPU E2E + `v1-colab-ml` | **Manual** | GPU session |
| 200 cite pair precision ≥ 0.92 | **Manual** | Label + eval |
| 10 real PDF coord-diff ≤ 1px | **Manual** | PDF collection |
| Colab heartbeat live test (prod URL) | **Manual** | Post-deploy |

Kod tarafı hazır; yukarıdaki kapılar hard launch sign-off için gereklidir.

---

## 9. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Public pages show OpenAlex fallback badge | Worker down or empty index | Check `$WORKER_URL/health`; verify D1 ingest |
| Timeline 502 | Worker configured, timeline query failed | Check api logs; verify `SCHOLARPULSE_API_BASE_URL` |
| Recommend empty | No library seeds | Save papers via Desk/Library |
| QC web build fail | Stale `.next` | §2 clean + rebuild |
| Heartbeat `stale: true` | Colab disconnected > 30 min | Resume runner with `--heartbeat-every 600` |

---

*Minimal $0 ops runbook. For Ar-Ge status see `docs/ARGE_FINAL_2026.md` and `docs/ARGE_ZERO_COST_IMPLEMENT_PLAN.md`.*
