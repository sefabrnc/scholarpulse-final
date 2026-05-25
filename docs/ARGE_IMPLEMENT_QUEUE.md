# ScholarPulse Ar-Ge Implement Queue 2026

Tarih: 2026-05-25 (Final Ar-Ge turu)
Kriter: $0 maliyet, yuksek ROI, kucuk diff, over-engineering degil
Ana plan: `c:/Users/sefab/.cursor/plans/tek_cümle_5184c22d.plan.md`
Final rapor: `docs/ARGE_FINAL_2026.md`

## Tamamlanan (bu tur)

| # | Is | Dosyalar | Dogrulama |
|---|---|---|---|
| 1 | Search batch influential badges (N+1 fix) | `apps/api/src/index.ts`, `apps/web/app/api/papers/badges/route.ts`, `hooks/usePaperBadgesBatch.ts`, `app/search/page.tsx` | typecheck |
| 2 | Colab CE threshold plan parity (0.85) | `colab/pipeline/config.py` | env default |
| 3 | QC public-route false positive azaltma | `scripts/qc/run.js` | node scripts/qc/run.js |
| 4 | pdfjs legacy type shim (onceki tur) | `apps/web/types/pdfjs-dist-legacy.d.ts` | tsc green |
| 5 | Library collections tree + paper add/remove | `apps/web/components/library/CollectionTree.tsx`, collection API proxies | typecheck |
| 6 | Desk annotation overlay + note popup | `AnnotationOverlayLayer.tsx`, `useAnnotations.ts`, `HomePageClient.tsx` | typecheck |
| 7 | Reading session debounced desk sync | `useReadingSession.ts`, `/api/sessions/update` proxy | typecheck |
| 8 | Library export modal (BibTeX/RIS/JSON) | `ExportLibraryModal.tsx`, GET `/api/export/library` | typecheck |
| 5 | Colab gercek ML model swap + stub fallback | `colab/pipeline/models/*`, `main.py`, `README.md` | smoke_test + compileall |
| 9 | CiteFusion intent + COLAB compute budget doc | `colab/pipeline/models/intent.py`, `docs/COLAB_COMPUTE_BUDGET.md` | smoke_test + compileall |
| 10 | GROBID TEI parse + DOI canonicalization sikilastirma | `clients/grobid.py`, `clients/canonicalization.py` | smoke_test |

## P0 — Launch blocker (sirali)

| # | Is | Effort | Bagli todo | Cikis kriteri |
|---|---|---|---|---|
| 1 | Qwen3-Embedding-0.6B Colab swap (stub kaldir) | L | colab-pipeline-8pass | algorithm_version != v0-skeleton (Colab GPU'da) |
| 2 | CiteFusion SciCite WS intent (HF proxy + optional local weights) | M | citation-intent-pipeline | backend != stub on Colab GPU |
| 3 | gte-reranker-modernbert veya Qwen3-Reranker entegrasyon | L | colab-pipeline-8pass | gercek CE skorlari bulk-ingest (Colab GPU'da) |
| 4 | 200 gercek cite cifti etiket + eval gate | M | cite-quality-eval | precision olcumu >=0.92 (hedef 0.95) |
| 5 | Web next build stabilizasyonu | S | quality-control-work | `pnpm --filter @scholarpulse/web build` 3x green |

## P1 — Competitive gap

| # | Is | Effort | Rakip | Not |
|---|---|---|---|---|
| 5 | 10 gercek PDF coord-diff harness | M | - | <=1px veya known-issue list |
| 6 | Browser extension Scholar/PubMed row badge | M | Scite | MV3 content script |
| 7 | Zotero plugin kolon parity (support/contrast) | M | Scite | extension Phase 2 |
| 8 | Library multi-seed timeline | M | Connected Papers | coklu DOI seed — **shipped** LibraryTimelinePreview + `ids` param on `/api/cite/timeline` |
| 9 | Smart recommend feed UI polish | S | ResearchRabbit | completed — /api/recommend + feed semantic/graph split UI |
| 10 | Public authors/topics Worker proxy | S | authors-api, topics-evolution | completed — /api/public/* Worker first, OpenAlex fallback |
| 10 | GROBID hibrit routing (temiz vs kirli PDF) | M | arXiv:2603.13651 | env flag SP_GROBID_MODE | **shipped** — pass0_5 + pdf_quality.py |
| 11 | Kaggle GPU yedek + Drive checkpoint | M | - | 24/7 ingest | **shipped** — ingest_pipeline.ipynb + checkpoint.py |

## P2 — Quality debt

| # | Is | Effort | Not |
|---|---|---|---|
| 12 | Supabase SSR auth tamamla | M | cf-pages-auth | completed — optional @supabase/ssr middleware |
| 13 | navigator.storage.persist() PWA | S | dark-mode-pwa |
| 14 | Hot path D1 LIMIT audit | S | QC unbounded SELECT |
| 15 | Tek DLQ gozlem paneli | S | circuit-breaker-dlq | **next:** D1 ingest_dlq + CF Queue DLQ tek admin view |
| 16 | Colab heartbeat alert CF Notifications | S | observability-stack | **next:** `/api/internal/heartbeat` 30dk timeout → CF Notification |
| 17 | Public API upstream error surfacing | S | fallback stub yerine 502 | **next:** `/api/public/*` Worker fail → 502 + source badge |
| 18 | Timeline normRect API field (Worker->Web) | S | mock defaultRect kaldir | **next:** `/api/cite/timeline` response normRect zorunlu alan |
| 19 | docs/runbook: deploy + eval + QC rerun | S | quality-gates genislet | **next:** `docs/runbook.md` — build flake, Colab GPU, eval gates |

## P3 — Ertelenmis

| # | Is | Not |
|---|---|---|
| 20 | Zotero OAuth sync | Phase 1.5 |
| 21 | OCR PyMuPDF4LLM | Phase 3 |
| 22 | Co-citation GraphML export | Phase 2 |
| 23 | Email notifications | Phase 3 kullanici tasarimi |

## YAPMA listesi (Over-engineering trap)

1. 50M scale doi_prefix sharding simdi
2. LLM Q&A (Workers AI / paid API)
3. Full microservices / Kubernetes split
4. Complex admin dashboard v1
5. Qwen3-8B embed upgrade (eval oncesi)
6. Real-time WebSocket cite sync
7. Multi-region active-active D1 writes
8. Custom OLAP / BigQuery pipeline Phase 1
9. Visual embedding (Qwen3-VL) Phase 1
10. Scite MCP connector (ucretli ecosystem)

## Final tur oncelikleri (2026-05-25)

| # | Is | P | Durum | Cikis kriteri |
|---|---|---|---|---|
| F1 | Colab T4 GPU E2E ingest | P0 | **blocked** — GPU oturumu | `algorithm_version=v1-colab-ml` bulk POST |
| F2 | 200 cite cifti etiket + precision gate | P0 | **blocked** — CSV yok | `labeled_pairs.real.csv` + precision >=0.92 |
| F3 | 10 gercek PDF coord-diff | P1 | **blocked** — pdfs/ bos | pixel diff <=1px manifest PASS |
| F4 | Web build 3x CI gate | P2 | izlemede | QC green; flake runbook dokumante |
| F5 | Extension Supabase OAuth | P2 | pending | chrome.identity; x-user-id kaldir |

## Runbook (kisa)

```bash
# Repo root: scholarpulse-final/

# QC raporu yenile
node scripts/qc/run.js

# Typecheck
corepack pnpm --filter @scholarpulse/api typecheck
corepack pnpm --filter @scholarpulse/web typecheck

# Web build (once .next sil gerekirse)
Remove-Item -Recurse -Force apps/web/.next -ErrorAction SilentlyContinue
corepack pnpm --filter @scholarpulse/web build

# Eval gates
python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.real.csv \
  --threshold 0.85 --min-precision 0.92 --require-zero-fp
```

Colab threshold env:
- `SP_CE_THRESHOLD=0.85` (default, plan gate)
- `SP_HIGH_CONFIDENCE_THRESHOLD=0.95`
- `SP_VECTOR_SCORE_THRESHOLD=0.50`
