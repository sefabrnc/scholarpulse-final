# ScholarPulse — $0 Maliyet Implement Planı

**Tarih:** 2026-05-25  
**Repo:** `scholarpulse-final`  
**Kaynaklar:** `docs/ARGE_FINAL_2026.md`, `docs/ARGE_GAP_MATRIX_2026.md`, `docs/ARGE_IMPLEMENT_QUEUE.md`, `docs/REMAINING_WORK.md`, `.qc/latest-report.json`  
**Kısıt:** $0 only — Colab Free / Kaggle Free, CF free tier, açık kaynak, manuel etiketleme. Colab Pro, Scite Pro, paid API **YOK**.

---

## Executive Summary

| Kategori | Adet | Launch etkisi |
|---|---:|---|
| Zaten shipped ($0) | 18 | Platform ~92% feature-complete |
| Hemen yapılabilir (kod-only, 1–3 gün) | 10 | Kalite + güven + demo polish |
| Manuel ama $0 (GPU / etiket / PDF) | 5 | **Hard launch P0 kapıları** |
| Ertelemeli (TRAP / düşük ROI) | 12 | Phase 2+ veya hiç |

**Hard launch sign-off** üç manuel kapıya bağlı: Colab GPU E2E, 200 cite çifti precision gate, 10 gerçek PDF coord-diff. Kod tarafı hazır; kanıt üretimi bekliyor.

---

## 1. Tam Envanter — Tüm $0 Maddeler

Aşağıdaki tablo gap matrix + implement queue + final rapordan birleştirilmiştir. Maliyet sütunu yalnızca $0 olanlar dahildir.

| # | Madde | P | Durum | Repo kanıtı | Effort | Gün | Blokör | ROI |
|---|---|---|---|---|---:|---:|---|---|
| 1 | Colab GPU E2E + `v1-colab-ml` | P0 | **Kod shipped, GPU kanıt yok** | `colab/pipeline/models/*`, `colab/notebooks/ingest_pipeline.ipynb`, `colab/pipeline/smoke_test.py` (stub path) | L | 3–5 | Colab/Kaggle GPU oturumu | **Yüksek** |
| 2 | 200+ gerçek cite çifti precision ≥0.92 | P0 | **Araç shipped, CSV yok** | `eval/citation_benchmark/admin_label.py`, `import_pairs.py`, `evaluate_precision.py`, `CI_GATE.md` — `labeled_pairs.real.csv` **yok** | M | 3–5 | Manuel etiket + Colab CE skorları | **Yüksek** |
| 3 | 10 gerçek PDF coord-diff ≤1px | P1 | **Fixture 15/15 PASS, PDF yok** | `eval/coord_diff/coord_diff_harness.py`, `validate_manifest.py`, `eval/coord_diff/pdfs/.gitkeep` (boş) | M | 2–3 | Yerel OA PDF koleksiyonu | **Yüksek** |
| 4 | Search batch influential badges (N+1) | P2 | **DONE** | `apps/web/app/api/papers/badges/route.ts`, `apps/web/hooks/usePaperBadgesBatch.ts`, `apps/api/src/index.ts` | — | — | — | — |
| 5 | CE threshold plan parity 0.85 | P2 | **DONE** | `colab/pipeline/config.py` → `SP_CE_THRESHOLD` default `0.85` | — | — | — | — |
| 6 | QC public-route false positive skip | P2 | **DONE** | `scripts/qc/run.js` | — | — | — | — |
| 7 | pdfjs-dist legacy type shim | P2 | **DONE** | `apps/web/types/pdfjs-dist-legacy.d.ts` | — | — | — | — |
| 8 | GROBID hibrit routing (temiz/kirli PDF) | P2 | **DONE** | `colab/pipeline/stages/pass0_5_reference_parser.py`, `colab/pipeline/helpers/pdf_quality.py`, `SP_GROBID_MODE=auto` | — | — | — | — |
| 9 | Kaggle GPU yedek + Drive checkpoint | P1 | **DONE** | `colab/pipeline/checkpoint.py`, `colab/notebooks/ingest_pipeline_runner.py` | — | — | — | — |
| 10 | Library multi-seed timeline | P1 | **DONE** | `apps/web/components/library/LibraryTimelinePreview.tsx`, `/api/cite/timeline?ids=` | — | — | — | — |
| 11 | Public authors/topics Worker-first proxy | P1 | **DONE** | `apps/web/app/api/public/authors/[name]/route.ts`, `topics/[name]/route.ts`, `_lib/publicUpstream.ts` | — | — | — | — |
| 12 | Smart recommend API + feed UI split | P1 | **Kısmen** | `apps/api/src/index.ts` `/api/recommend`; feed sayfası semantic/graph bölümü shipped — UI polish kaldı | S | 1 | — | Orta |
| 13 | Colab 8-pass ML loader (Qwen3/gte/CiteFusion) | P0 | **Kod shipped, GPU doğrulanmadı** | `colab/pipeline/models/embedding.py`, `reranker.py`, `intent.py`, `main.py` | L | 1–2* | *GPU ile birlikte #1 | **Yüksek** |
| 14 | CiteFusion SciCite WS intent (Pass 5) | P0 | **Kod shipped, stub local** | `colab/pipeline/models/intent.py`, `stages/pass5_intent.py` | M | 1–2* | GPU (#1) | **Yüksek** |
| 15 | Browser extension MV3 scaffold | P2 | **Kısmen** | `extensions/browser/` — Scholar/PubMed badge, popup; OAuth **yok** | M | 3–5 | Supabase OAuth config | Orta |
| 16 | Extension Supabase OAuth (`chrome.identity`) | P2 | **Pending** | `extensions/browser/README.md` § Next steps; hâlâ manual `x-user-id` | M | 3–5 | OAuth client + CF Pages callback | Orta |
| 17 | Public API upstream 502 + source badge | P2 | **Pending** | `apps/web/app/api/public/search/route.ts` — yalnız OpenAlex; Worker fail sessiz fallback (`fetchWorkerJson` → `null`) | S | 1 | — | **Yüksek** |
| 18 | Timeline normRect Worker→Web (mock kaldır) | P2 | **Pending** | Worker: `apps/api/src/index.ts` normRect döner; Web proxy: `apps/web/app/api/cite/timeline/route.ts` → `defaultRect()` mock fallback | S | 1 | — | **Yüksek** |
| 19 | `navigator.storage.persist()` PWA | P2 | **Pending** | `apps/web/components/pwa/PwaRegister.tsx` — yalnız SW register, persist yok | S | 0.5 | — | Orta |
| 20 | Vectorize topK=50 recommend artırımı | P2 | **Pending** | `apps/api/src/index.ts` → `candidate_limit` max 150 ama Vectorize `topK` sabit 100 civarı; CF Mart 2026 limit 50 metadata | S | 0.5 | — | Orta |
| 21 | D1 unbounded SELECT audit (QC 8 medium) | P2 | **Pending** | `.qc/latest-report.json` — 8 medium `index.ts` + library export path'leri | S–M | 1–2 | — | Orta |
| 22 | Tek DLQ gözlem paneli (D1 + Queue) | P2 | **Kısmen** | `GET /api/internal/dlq` shipped (`apps/api/src/index.ts`); birleşik admin view **yok** | S | 1 | — | Orta |
| 23 | Colab heartbeat endpoint + alert | P2 | **Pending** | Dokümantasyon: `docs/observability-stack.md`, runner: `ingest_pipeline_runner.py --heartbeat-every`; **Worker'da `/api/internal/heartbeat` route yok** (grep: 0 match) | S–M | 1–2 | CF Notifications dashboard (free) | **Yüksek** |
| 24 | Logpush / Analytics Engine prod deploy | P2 | **Pending** | `docs/observability-stack.md` — in-process metrics shipped; prod Logpush deploy bekliyor | S | 1 | CF dashboard erişimi | Orta |
| 25 | Web build 3× CI gate + flake runbook | P2 | **İzlemede** | `.qc/latest-report.json` (2026-05-24): web typecheck+build **failed** (2 error); `docs/runbook.md` **yok** | S | 1–2 | Windows `.next` flake | **Yüksek** |
| 26 | Supabase SSR auth middleware | P2 | **DONE** | `apps/web/middleware.ts`, `@supabase/ssr`, plan todo `cf-pages-auth` completed | — | — | — | — |
| 27 | Public routes (paper/cite/timeline/search) | P1 | **Kısmen** | `apps/web/app/api/public/*` — authors/topics Worker-first; search/timeline/cite **OpenAlex-only** | M | 2 | Worker URL env | Orta |
| 28 | Scite MCP agent entegrasyonu | P1 | **Yok — Phase 2/TRAP** | REST API var; MCP connector yok | L | — | Ecosystem farklı | Düşük (Phase 1) |
| 29 | Elicit-style AI tablo/claim extraction | P1 | **Yok — Phase 2** | Manuel export Phase 2 | L | — | — | Düşük |
| 30 | Semantic Scholar SPECTER2 embedding | P1 | **Ertele** | OpenAlex + kendi Vectorize yeterli | — | — | — | Düşük |
| 31 | GLB-Cite intent SOTA A/B | P2 | **Ertele** | CiteFusion WS proxy shipped (`colab/pipeline/models/intent.py`) | M | — | Eval sonrası | Düşük |
| 32 | Zotero OAuth sync | P3 | **Ertele** | BibTeX import shipped; OAuth Phase 1.5 | M | — | OAuth | Düşük |
| 33 | OCR scanned PDF (PyMuPDF4LLM) | P3 | **Ertele** | `ocr-skip-policy` shipped — skip + log | L | — | Phase 3 | Düşük |
| 34 | 50M doi_prefix sharding | TRAP | **YAPMA** | `phase3-deferred` cancelled | XL | — | — | — |
| 35 | LLM Q&A (Workers AI / paid API) | TRAP | **YAPMA** | `ai-qa-deferred` cancelled | XL | — | — | — |
| 36 | Qwen3-8B embed upgrade | TRAP | **YAPMA** | `docs/COLAB_COMPUTE_BUDGET.md` — 0.6B yeterli | L | — | VRAM | — |
| 37 | Real-time WebSocket cite graph | TRAP | **YAPMA** | REST + polling yeterli | L | — | — | — |
| 38 | Complex admin dashboard v1 | TRAP | **YAPMA** | `/api/internal/*` yeterli | L | — | — | — |
| 39 | Full microservices / K8s | TRAP | **YAPMA** | Monorepo CF Workers doğru | XL | — | — | — |
| 40 | R2 Parquet 50M / closed-access harvest | TRAP | **YAPMA** | `phase3-deferred` | XL | — | — | — |

---

## 2. Önceliklendirilmiş Implement Listesi

### A. Hemen yapılabilir (1–3 gün, kod-only)

| Sıra | Aksiyon | Effort | Gün | Dosyalar | Çıkış kriteri | ROI |
|---|---|---|---|---|---|---|
| A1 | Public API Worker-fail → **502 + source badge** (stub yerine) | S | 1 | `apps/web/app/api/_lib/publicUpstream.ts`, `app/api/public/*/route.ts` | Worker down iken `{ error, source: "openalex_fallback" }` veya 502; UI badge | **Yüksek** |
| A2 | Timeline **normRect mock kaldır** — Worker yanıtını zorunlu kullan | S | 1 | `apps/web/app/api/cite/timeline/route.ts` (`defaultRect` sil), `apps/api/src/index.ts` | Mock timeline yalnız `UPSTREAM_UNSET`; gerçek coord snippet | **Yüksek** |
| A3 | **`/api/internal/heartbeat`** POST + KV timestamp + 30dk stale check | S | 1 | `apps/api/src/index.ts`, `docs/observability-stack.md` | Colab runner heartbeat 200; stale → metrics flag | **Yüksek** |
| A4 | **`docs/runbook.md`** — build flake, Colab GPU, eval gates, QC rerun | S | 0.5 | Yeni `docs/runbook.md`, `docs/quality-gates.md` referans | Tek sayfa operasyon rehberi | **Yüksek** |
| A5 | Web build flake — `.next` temizlik script + 3× build gate doc | S | 1 | `apps/web/scripts/prebuild.mjs`, `docs/runbook.md` | `pnpm --filter @scholarpulse/web build` 3× ardışık green | **Yüksek** |
| A6 | **`navigator.storage.persist()`** opt-in PWA | S | 0.5 | `apps/web/components/pwa/PwaRegister.tsx` | Offline PDF cache eviction riski azalır | Orta |
| A7 | Vectorize **topK=50** recommend artırımı | S | 0.5 | `apps/api/src/index.ts` `/api/recommend` | `candidate_limit` + Vectorize topK hizalı; metadata filter test | Orta |
| A8 | D1 **hot path LIMIT** audit (QC 8 medium) | S–M | 1–2 | `apps/api/src/index.ts` (1488, 2317, 2844, 4709, 5200, 6115, 6287), library export | QC bottleneck medium → 0 | Orta |
| A9 | **Tek DLQ admin view** — D1 `ingest_dlq` + Queue birleşik JSON | S | 1 | `apps/api/src/index.ts` `/api/internal/dlq`, yeni `/api/internal/dlq/summary` | Tek endpoint'te her iki kaynak | Orta |
| A10 | Smart recommend **feed UI polish** (seed count, empty state) | S | 1 | Feed sayfası + `/api/recommend` consumer | ResearchRabbit parity görsel | Orta |

**Toplam kod-only tahmini:** ~7–10 kişi-gün (paralel 3–4 gün).

---

### B. Manuel ama $0 (launch kapıları)

| Sıra | Aksiyon | Effort | Gün | Komut / araç | Blokör | ROI |
|---|---|---|---|---|---|---|
| B1 | **Colab T4 GPU E2E ingest** | L | 3–5 | `colab/notebooks/ingest_pipeline.ipynb` veya `ingest_pipeline_runner.py --ingest` | GPU kota (Colab Free / Kaggle 30h/hafta) | **Yüksek** |
| B2 | **200 cite çifti etiketleme** | M | 3–5 | `python eval/citation_benchmark/admin_label.py --candidates eval/citation_benchmark/candidates.template.json --output eval/citation_benchmark/labeled_pairs.real.csv` | İnsan saati (~4–8 saat etiket) | **Yüksek** |
| B3 | **Precision gate çalıştır** | S | 0.5 | `python eval/citation_benchmark/evaluate_precision.py --input labeled_pairs.real.csv --threshold 0.85 --min-precision 0.92` | B1 CE skorları import (`import_pairs.py`) | **Yüksek** |
| B4 | **10 gerçek PDF coord-diff** | M | 2–3 | PDF'leri `eval/coord_diff/pdfs/` → `pdf_cases.json` manifest → `python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0` | OA PDF indirme (telif-safe) | **Yüksek** |
| B5 | **Colab heartbeat canlı test** | S | 0.5 | `ingest_pipeline_runner.py --heartbeat-every 600` + A3 endpoint deploy | A3 kod shipped + prod Worker URL | Orta |

**Kritik yol:** B1 → B2+B3 (paralel B4).

---

### C. Ertelemeli (over-engineering veya düşük ROI)

| Madde | Neden ertele |
|---|---|
| 50M doi_prefix sharding / R2 Parquet | D1 Free 160K paper yeter; Phase 3 |
| LLM Q&A (Workers AI, paid API) | Maliyet + halüsinasyon; cancelled todo |
| Scite MCP connector | Ücretli ecosystem; farklı segment |
| Qwen3-Embedding-8B upgrade | T4 VRAM; eval öncesi gereksiz |
| Real-time WebSocket cite graph | REST + polling yeterli; spatial OS prensibi |
| Full microservices / K8s | Monorepo CF Workers doğru mimari |
| Complex admin dashboard v1 | `/api/internal/*` minimal yeterli |
| GLB-Cite / MF-Cite entegrasyon | CiteFusion WS proxy Phase 1 yeterli |
| Elicit-style AI extraction | Manuel table export Phase 2 |
| Semantic Scholar SPECTER2 | OpenAlex + Vectorize yeterli |
| Zotero OAuth | Phase 1.5; BibTeX import shipped |
| OCR auto (PyMuPDF4LLM) | Phase 3; skip policy shipped |

---

## 3. Zaten Shipped — $0 Kanıt Listesi (referans)

| Özellik | Kanıt dosyası |
|---|---|
| 8-pass Colab pipeline iskelet + model loader | `colab/pipeline/main.py`, `models/loader.py` |
| Bulk ingest Worker | `apps/api/src/index.ts` `POST /api/cite/bulk-ingest` |
| PDF proxy + circuit breaker | `apps/api/src/index.ts` `/api/pdf/proxy`, DLQ |
| Timeline + split view + coord snippet | `apps/web/components/timeline/*`, `utils/pdf/normRect.ts` |
| Influential badges batch | `apps/web/app/api/papers/badges/route.ts` |
| Public shareable routes | `apps/web/app/paper/[doi]`, `cite/[id]`, `timeline/[sid]`, `search` |
| PWA shell + dark mode | `apps/web/public/manifest.webmanifest`, `sw.js`, `ThemeClient.tsx` |
| Annotations + reading sessions | `AnnotationOverlayLayer.tsx`, `useReadingSession.ts` |
| Library collections + export | `CollectionTree.tsx`, `ExportLibraryModal.tsx` |
| Extension MV3 scaffold | `extensions/browser/manifest.json` |
| Eval harness (sentetik blocked) | `eval/citation_benchmark/evaluate_precision.py`, `eval/coord_diff/` |
| QC runner | `scripts/qc/run.js` → `.qc/latest-report.json` |

---

## 4. QC Durumu (2026-05-24)

| Metrik | Değer | Not |
|---|---:|---|
| errors | 2 | Web typecheck + build failed |
| passedChecks | 8 | API green |
| bottlenecks | 25 | 8 medium unbounded SELECT |

**Aksiyon:** A4 + A5 runbook ve build stabilizasyonu öncelikli. API tarafı production-ready.

---

## 5. Net Aksiyon Maddeleri (bu hafta)

### Kod (sıralı)

- [ ] **A1** Public route'larda Worker fail → 502 veya explicit fallback badge
- [ ] **A2** Timeline proxy'den `defaultRect()` mock kaldır
- [ ] **A3** `/api/internal/heartbeat` implement et
- [ ] **A4** `docs/runbook.md` yaz
- [ ] **A6** PWA `storage.persist()` ekle
- [ ] **A7** Recommend Vectorize topK artır
- [ ] **A8** D1 LIMIT audit (QC medium → 0)

### Manuel (paralel)

- [ ] **B1** Colab Free T4: 1 PDF → bulk POST → D1 doğrula (`algorithm_version=v1-colab-ml`)
- [ ] **B2** 200 cite çifti: `admin_label.py` ile etiketle
- [ ] **B4** 10 OA PDF indir → coord-diff manifest doldur

### Doğrulama

```bash
# Repo root
node scripts/qc/run.js
corepack pnpm --filter @scholarpulse/api typecheck
corepack pnpm --filter @scholarpulse/web typecheck
python -m colab.pipeline.smoke_test
python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.real.csv \
  --threshold 0.85 --min-precision 0.92 --require-zero-fp
```

---

## 6. Launch Readiness Tahmini

| Mod | Hazırlık | Eksik |
|---|---:|---|
| Soft demo (stub/sentetik ML) | ~85% | A1–A2 polish, public route 502 |
| Hard launch (precision + coord + GPU) | ~68% | B1–B4 manuel kapılar |

---

*Bu plan repo kod audit + QC + Ar-Ge dokümanları ile üretilmiştir. Over-engineering trap maddeleri bilinçli hariç tutulmuştur.*
