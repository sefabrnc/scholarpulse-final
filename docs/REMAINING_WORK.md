# Remaining Work — Plan Todo Audit

**Audit date:** 2026-05-25  
**Repo:** `scholarpulse-final`  
**Plan:** `tek_cümle_5184c22d.plan.md`  
**Sources:** repo code audit, `.qc/latest-report.json`, `docs/ARGE_GAP_MATRIX_2026.md`, `docs/ARGE_IMPLEMENT_QUEUE.md`

## Todo status summary

| Status | Count | Todo IDs |
|---|---:|---|
| **completed** | 46 | All shipped Phase 1 features (see plan frontmatter) |
| **in_progress** | 7 | `quality-control-work`, `colab-pipeline-8pass`, `citation-intent-pipeline`, `browser-extension`, `observability-stack`, `coord-diff-test`, `cite-quality-eval` |
| **cancelled** | 2 | `ai-qa-deferred`, `phase3-deferred` |
| **pending** | 0 | — |

**Launch blockers (P0):** Colab GPU ingest validation, real cite precision labels, web build stability gate.

## ETA table (remaining in_progress)

| Todo ID | Remaining scope | Effort | ETA | Owner / gate |
|---|---|---:|---|---|
| `quality-control-work` | 3× consecutive `pnpm --filter @scholarpulse/web build` green outside QC; document flake runbook | S | 1–2 days | Web platform; CI gate |
| `colab-pipeline-8pass` | Colab T4 end-to-end: PDF → bulk POST → D1/Vectorize with `algorithm_version=v1-colab-ml` | L | 3–5 days | Colab GPU session |
| `citation-intent-pipeline` | Validate real intent inference on GPU bulk ingest (stub path OK locally) | M | 1–2 days (with colab) | Depends on `colab-pipeline-8pass` |
| `cite-quality-eval` | **Workstream D shipped:** `admin_label.py`, `import_pairs.py`, `CI_GATE.md`, `candidates.template.json`. Pending: 200+ labeled rows in `labeled_pairs.real.csv` + pipeline CE scores → precision gate ≥0.92 | M | 3–5 days (labeling) | Admin labeling + Colab scores |
| `coord-diff-test` | **Workstream D shipped:** `validate_manifest.py` CLI. Pending: copy `pdf_cases.template.json` → `pdf_cases.json`, add 10 real PDFs under `eval/coord_diff/pdfs/`, pixel diff ≤1px | M | 2–3 days | Eval harness + local PDFs |
| `browser-extension` | Supabase OAuth via `chrome.identity` (replace manual x-user-id) | M | 3–5 days | Extension + auth |
| `observability-stack` | Production Logpush/Analytics Engine deploy + Colab heartbeat alert | S–M | 2–3 days | Ops / CF dashboard |

**Rough critical-path to launch sign-off:** ~2 weeks (parallel: Colab GPU + labeling + build stability).

## Verification snapshot (2026-05-25)

| Check | Result |
|---|---|
| QC runner (`node scripts/qc/run.js`) | errors **0**, passedChecks **10** |
| API typecheck + build | green |
| Web typecheck | green |
| Web build (manual) | **flaky** — intermittent `.next` ENOENT / `middleware-manifest.json` parse errors |
| Coord diff fixtures (15 JSON) | **15/15 PASS** (`<=1px`) |
| Real PDF coord diff | not started (`eval/coord_diff/pdfs/` empty) |
| Citation precision gate | blocked — `labeled_pairs.real.csv` missing |
| Colab ML on GPU | code shipped; `v1-colab-ml` not validated end-to-end |

## Cancelled (unchanged)

- **`ai-qa-deferred`** — App içi LLM Q&A Phase 3; deterministic intent + recommend yeterli.
- **`phase3-deferred`** — 50M scale, mail, OCR auto, Qwen3-8B, visual embedding, LLM Q&A; kullanıcı tasarlayacak.

## Reference

- P0 queue: `docs/ARGE_IMPLEMENT_QUEUE.md` § P0
- Gap matrix: `docs/ARGE_GAP_MATRIX_2026.md`
- QC rerun: `node scripts/qc/run.js` → `.qc/latest-report.json`
