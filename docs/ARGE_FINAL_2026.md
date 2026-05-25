# ScholarPulse Final Ar-Ge Raporu 2026

**Tarih:** 2026-05-25  
**Proje:** scholarpulse-final  
**Ana plan:** `c:/Users/sefab/.cursor/plans/tek_cümle_5184c22d.plan.md`  
**QC:** `.qc/latest-report.json` (2026-05-24T21:39:47Z)  
**Kısıt:** $0 stack, commit/push yok

---

## Executive Summary

### Launch readiness: **~68%**

| Boyut | Skor | Kanıt |
|---|---:|---|
| Platform / API / Web özellikleri | 92% | 46/55 plan todo **completed**; API+Web typecheck+build green |
| QC / statik analiz | 88% | QC **0 error**, 10 passed check; 25 bottleneck (çoğu low), 1 logic risk |
| ML pipeline kod | 78% | 8-pass iskelet + Qwen3/gte/CiteFusion loader shipped; smoke_test green |
| ML üretim doğrulama | 18% | Colab T4 GPU E2E yok; `algorithm_version=v1-colab-ml` doğrulanmadı |
| Kalite kapıları (eval) | 35% | Coord diff 15/15 fixture PASS; gerçek PDF + gerçek cite etiket yok |
| Ops / observability | 65% | In-process metrics + x-trace-id; Logpush/Analytics Engine deploy bekliyor |

**Yorum:** Ürün özellik seti Phase 1 için neredeyse tamam; **launch sign-off** üç P0 kapıya bağlı: (1) Colab GPU bulk ingest, (2) 200+ gerçek cite çifti precision gate, (3) 10 gerçek PDF coord-diff. Kritik yol ETA ~2 hafta (paralel: GPU oturumu + etiketleme + build stabilizasyonu).

**Launch modları:**
- **Soft demo (bugün):** Public routes, timeline, search, desk PDF viewer — mümkün; ML skorları stub/ sentetik olabilir.
- **Hard launch (hedef):** Precision ≥0.92 + gerçek PDF coord + `v1-colab-ml` GPU kanıtı — **~68% hazır**.

---

## 1. Güncel Durum Özeti (Repo + QC)

### 1.1 QC raporu (2026-05-24)

| Metrik | Değer |
|---|---:|
| errors | 0 |
| passedChecks | 10 |
| skippedChecks | 4 (lint/test yapılandırılmamış) |
| bottlenecks | 25 (8 medium unbounded SELECT, 17 low nested map) |
| logicRisks | 1 (TODO/FIXME `index.ts:5486`) |

**Geçen kapılar:** api/web typecheck, api/web build, explicit-any, empty-catch, uncaught-promise, performance heuristic (115 dosya).

**Kalan QC borcu:** Hot path LIMIT audit (timeline/search OK; admin/library export path'leri medium severity). Lint/test script'leri yok — CI kapsamı dar.

### 1.2 Plan todo durumu

| Durum | Adet |
|---|---:|
| completed | 46 |
| in_progress | 6–7* |
| cancelled | 2 |

\*Plan frontmatter'da `quality-control-work` **completed** (QC tur 4); `REMAINING_WORK.md` hâlâ build flake için izleme listesinde tutuyor.

### 1.3 Bu tur web araştırması (2025–2026, gerçek kaynaklar)

#### Citation tools / rakipler

| Rakip | 2026 güncelleme | ScholarPulse etkisi |
|---|---|---|
| **Scite** | Smart Citations (support/contrast/mention); **Scite MCP** — ChatGPT/Claude/Cursor'a 250M+ makale + citation context ([scite.ai/mcp](https://scite.ai/blog/introducing-scite-mcp), [Best MCP 2026](https://scite.ai/blog/best-mcp-for-research-2026)) | Paper-level intent + MCP ekosistemi; biz sentence+coord unique ama MCP/agent entegrasyonu yok |
| **Elicit** | 138M+ paper, systematic review, custom extraction columns; citation intelligence yok ([Elicit vs Scite 2026](https://paperguide.ai/blog/elicit-vs-scite/)) | Tablo/claim extraction boşluğu devam; coord-snippet farklı segment |
| **Connected Papers / RR / Litmaps** | Visual discovery; intent/coord yok ([2025 karşılaştırma](https://effortlessacademic.com/litmaps-vs-researchrabbit-vs-connected-papers-the-best-literature-review-tool-in-2025/)) | Multi-seed timeline shipped; graph edge bilinçli yok |
| **Citation MCP ekosistemi** | zotero-mcp, Scholar Sidekick, CiteAssist — identifier/format odaklı; Smart Citation evidence yok ([MCP roundup](https://scholar-sidekick.com/compare/citation-mcp-servers)) | Phase 2 MCP değil; önce coord API + extension |

#### Colab Free 2026

| Kısıt | Kaynak |
|---|---|
| GPU garanti değil; dinamik kota | [Colab FAQ](https://research.google.com/colaboratory/faq.html) |
| Oturum max **12 saat** | Colab FAQ |
| Boşta ~90 dk disconnect | [T4 guide](https://unanswered.io/guide/what-is-t4-gpu-google-colab) |
| T4 ~15 GB VRAM (ECC sonrası) | Colab runtime docs |
| **Yedek:** Kaggle **30 GPU saat/hafta**, oturum max **9–12 saat** | [Kaggle GPU limit](https://www.kaggle.com/general/108481), [kgz repo](https://github.com/mlnomadpy/kgz) |

**Strateji doğrulama:** Colab Free primary + Kaggle failover + Drive checkpoint (`colab/notebooks/ingest_pipeline.ipynb`) — $0 için doğru. Colab Pro alma TRAP.

#### Cloudflare Workers / D1 / Vectorize (2026)

| Servis | Limit / fiyat (Free → Paid) | ScholarPulse Phase 1 |
|---|---|---|
| **D1** | Free: 5 GB/account, 500 MB/DB, 100 bound param; Paid: 10 GB/DB, 1 TB/account ([limits](https://developers.cloudflare.com/d1/platform/limits/)) | ~160K paper (~31 KB/paper) Free içinde |
| **D1 pricing** | Free 5M read/gün, 100K write/gün; Paid 25B read/ay dahil ([pricing](https://developers.cloudflare.com/d1/platform/pricing/)) | Bulk ingest 50/chunk doğru |
| **Vectorize** | Max **10M vec/index** (Ocak 2026 2× artış); topK **50** metadata ile (Mart 2026) ([changelog 10M](https://developers.cloudflare.com/changelog/post/2026-01-23-increased-index-capacity/), [topK 50](https://developers.cloudflare.com/changelog/post/2026-03-16-topk-limit-increased-to-50/)) | 100K paper × 60 vec = 6M — tek index yeter |
| **Vectorize pricing** | Free 5M stored dims; Paid 10M stored + 50M queried/ay ([pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)) | 1024-dim Qwen3 stack uyumlu |
| **Workers** | 30s CPU, 100MB body | bulk-ingest chunking doğru |

#### CiteFusion / intent SOTA güncellemesi

| Model | SciCite Macro-F1 | ACL-ARC Macro-F1 | Kaynak |
|---|---:|---:|---|
| **CiteFusion** (SciBERT+XLNet ensemble) | **89.60%** | **76.24%** | [Scientometrics Oct 2025](https://link.springer.com/article/10.1007/s11192-025-05418-8) |
| MF-Cite (multi-feature fusion) | iyileşme (ablation) | iyileşme | [Jul 2025](https://link.springer.com/article/10.1007/s11192-025-05365-4) |
| **GLB-Cite** (2026) | **87.69%** | **79.79%** | [ScienceDirect 2026](https://www.sciencedirect.com/science/article/abs/pii/S0893608026004235) |
| ScholarPulse hedef | ≥0.50 (6-label) | — | CiteFusion WS proxy + optional local weights |

**Cikarim:** CiteFusion SciCite'te hâlâ SOTA; GLB-Cite ACL-ARC'ta daha iyi. Bizim pipeline CiteFusion WS + SciCite HF proxy doğru $0 seçim; tam ensemble ağırlıkları `SP_CITEFUSION_WEIGHTS_DIR` veya paper web app ([Zenodo 15011985](https://zenodo.org/records/15011985)).

---

## 2. Rakip Karşılaştırma (Güncel — May 2026)

| Özellik | Scite | Elicit | Conn. Papers | Semantic Scholar | ScholarPulse (kod) |
|---|---|---|---|---|---|
| Citation intent | Paper-level Smart Citations + MCP | Yok | Yok | influential count | Sentence+coord; GPU inference bekliyor |
| Koordinat bbox snippet | Yok | Yok | Yok | Yok | **Unique** — API + desk PDF viewer |
| MCP / AI agent entegrasyon | **Scite MCP shipped 2026** | Yok | Yok | API | Yok (Phase 2+) |
| AI extraction / tablo | Yok | **Core** | Yok | Yok | Yok (Phase 2 manual export) |
| Visual cite graph | Yok | Yok | Graph (1 seed) | Yok | Timeline no-edges + multi-seed |
| Browser extension | Scholar/PubMed badges | Yok | Yok | Yok | MV3 scaffold; OAuth pending |
| Veri derinliği | 1.6B+ citations, 40+ publisher | 138M papers | Metadata | S2AG | OpenAlex nightly |
| Full-text erişim | Publisher lisanslı + resolver | Sınırlı | Metadata | OA | Runtime PDF proxy (telif güvenli) |
| Fiyat | Ücretli | Freemium | Freemium | Ücretsiz | **$0 hedef** |

**Rekabet boşlukları (fırsat):** Koordinat-tabanlı snippet, split-view cite reading, telif-güvenli runtime render — hiçbir rakipte yok.

**Rekabet açıkları (risk):** Scite MCP + publisher full-text + 1.6B index; Elicit extraction; S2 SPECTER2 hazır embedding.

---

## 3. Bizim Unique Avantajlar

1. **Koordinat-only mimari** — Sunucuda metin/abstract/vektör metni yok; Project Alexandria uyumlu telif pozisyonu ([arXiv:2502.19413](https://arxiv.org/pdf/2502.19413)).
2. **Sentence-level cite edge + normRect** — Scite paper-level intent'ten daha granular; PDF.js overlay ile doğrudan okuma akışı.
3. **No-edge timeline UX** — Spatial block OS prensibi; görsel graph yerine kronolojik kart + coord crop.
4. **Strict bib→DOI + CE reranker** — Bibliyografik lookup'tan farklı; precision-first gate (CITE-AI attributable ekseni zorluğu bilinçli).
5. **$0 compute stack** — Colab Free T4 + Kaggle yedek + CF Free tier; rakiplerin ücretli AI/extraction katmanı yok.
6. **Deterministik quality gates** — coord_diff + citation_benchmark CI; sentetik PASS engellendi (`--allow-synthetic` smoke only).

---

## 4. Kalan 7 in_progress Todo Analizi

| # | Todo ID | Kalan iş | Blokör? | ETA | Bağımlılık |
|---|---|---|---|---|---|
| 1 | `quality-control-work` | Plan'da completed; build 3× green CI gate + flake runbook dokümantasyonu | P1 (flake) | 1–2 gün | Windows `.next` temizlik |
| 2 | `colab-pipeline-8pass` | Colab T4 E2E: PDF → bulk POST → D1/Vectorize; `algorithm_version=v1-colab-ml` | **P0** | 3–5 gün | GPU oturumu |
| 3 | `citation-intent-pipeline` | GPU'da gerçek CiteFusion/SciCite inference; stub yerine backend != stub | **P0** | 1–2 gün | #2 ile birlikte |
| 4 | `cite-quality-eval` | `labeled_pairs.real.csv` 200+ satır + pipeline CE skorları → precision ≥0.92 | **P0** | 3–5 gün | #2 + admin_label |
| 5 | `coord-diff-test` | 10 gerçek PDF → `eval/coord_diff/pdfs/` + pixel diff ≤1px | P1 | 2–3 gün | Yerel PDF koleksiyonu |
| 6 | `browser-extension` | `chrome.identity` Supabase OAuth (manuel x-user-id kaldır) | P2 | 3–5 gün | cf-pages-auth (shipped) |
| 7 | `observability-stack` | Logpush/Analytics Engine prod deploy + Colab heartbeat alert | P2 | 2–3 gün | CF dashboard |

**Kritik yol:** #2 → #3 → #4 (sıralı ML doğrulama). #5 ve #6 paralel.

**Not:** `standalone-web-sections`, `cf-pages-auth`, `legacy-cleanup` artık completed — önceki rapordaki "PDF viewer eksik" gap'i kapatıldı.

---

## 5. Over-Engineering Trap Hatırlatması

Aşağıdakiler **YAPMA** — launch öncesi scope creep:

| Trap | Neden ertele | Kaynak karar |
|---|---|---|
| 50M doi_prefix sharding | D1 Free 160K paper yeter | phase3-deferred |
| LLM Q&A (Workers AI / paid API) | Halüsinasyon + maliyet | ai-qa-deferred |
| Scite MCP connector | Ücretli ecosystem; farklı segment | Scite MCP blog |
| Qwen3-8B embed upgrade | T4 VRAM + eval öncesi gereksiz | COLAB_COMPUTE_BUDGET |
| Real-time WebSocket cite graph | REST + polling yeterli | spatial block OS prensibi |
| Full microservices / K8s | Monorepo CF Workers doğru | mimari karar |
| Complex admin dashboard v1 | `/api/internal/*` yeterli | circuit-breaker-dlq shipped |
| GLB-Cite / MF-Cite entegrasyon | CiteFusion WS proxy Phase 1 yeterli | bu rapor §1.3 |
| Elicit-style AI extraction | Manuel table export Phase 2 | gap matrix P1 |

**Altın kural:** Stub'ı gerçek modelle değiştir → gerçek benchmark → launch. Yeni feature ekleme.

---

## 6. Güncellenmiş Gap Özeti (P0 / P1 / P2)

Detay: [`docs/ARGE_GAP_MATRIX_2026.md`](./ARGE_GAP_MATRIX_2026.md)

| Severity | Adet (final tur) | Değişim |
|---|---:|---|
| **P0** | 3 | Web build P0 → P2 (typecheck+build green; flake izleme) |
| **P1** | 8 | +Scite MCP gap; GLB-Cite izleme notu |
| **P2** | 12 | +Vectorize topK 50 fırsatı; build flake |
| **P3** | 2 | — |
| **TRAP** | 6 | — |

### P0 — Launch blocker (değişmedi)

1. Colab GPU E2E + `v1-colab-ml` doğrulama
2. 200+ gerçek cite çifti precision gate (`labeled_pairs.real.csv` yok)
3. *(Web build artık P2 — QC green, flake runbook yeterli)*

### P1 — Competitive gap (güncel)

1. 10 gerçek PDF coord-diff
2. Scite MCP / agent entegrasyonu (Phase 2)
3. Browser extension OAuth
4. Elicit-style extraction (Phase 2)
5. Publisher full-text depth vs proxy throttle
6. Connected Papers visual polish (multi-seed shipped, UI polish)
7. ResearchRabbit discovery UX
8. Semantic Scholar SPECTER2 (OpenAlex yeterli Phase 1)

### P2 — Quality debt

1. Web build 3× CI gate + flake runbook
2. D1 unbounded SELECT audit (QC 8 medium)
3. Logpush/Analytics Engine prod
4. Colab heartbeat alert
5. PWA `navigator.storage.persist()`
6. Tek DLQ dashboard
7. Public API 502 surfacing
8. Timeline normRect Worker→Web
9. GROBID kirli PDF hibrit (shipped env flag; eval bekliyor)
10. Vectorize topK=50 ile recommend kalitesi A/B
11. Supabase SSR tam test (middleware shipped)
12. Extension error UX polish

---

## 7. Top 5 Kalan Risk

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **ML pipeline GPU'da doğrulanmadı** — local stub, gerçek precision bilinmiyor | Kritik | Colab T4 oturumu; `ingest_pipeline.ipynb` + Drive checkpoint |
| 2 | **Cite precision gate blocked** — `labeled_pairs.real.csv` yok | Kritik | `admin_label.py` + 200 çift; Colab CE skor import |
| 3 | **Coord diff sadece fixture** — gerçek PDF font/bbox sapması | Yüksek | 10 PDF manifest + pixel diff harness |
| 4 | **Scite MCP + publisher depth** — rekabet agent/ full-text katmanında önde | Orta | Phase 2 MCP; runtime proxy + circuit breaker koru |
| 5 | **Colab Free disconnect** — 12h max, dinamik kota | Orta | Kaggle 30h/week yedek; checkpoint resume |

---

## 8. Kaynaklar

### Rakipler & MCP
- Scite MCP: https://scite.ai/blog/introducing-scite-mcp
- Best MCP Research 2026: https://scite.ai/blog/best-mcp-for-research-2026
- Elicit vs Scite 2026: https://paperguide.ai/blog/elicit-vs-scite/
- Citation MCP roundup: https://scholar-sidekick.com/compare/citation-mcp-servers
- Litmaps vs RR vs CP: https://effortlessacademic.com/litmaps-vs-researchrabbit-vs-connected-papers-the-best-literature-review-tool-in-2025/

### Compute
- Colab FAQ: https://research.google.com/colaboratory/faq.html
- Kaggle GPU 30h/week: https://www.kaggle.com/general/108481
- Colab T4 specs: https://unanswered.io/guide/what-is-t4-gpu-google-colab

### Cloudflare
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Vectorize limits: https://developers.cloudflare.com/vectorize/platform/limits/
- Vectorize 10M changelog: https://developers.cloudflare.com/changelog/post/2026-01-23-increased-index-capacity/
- Vectorize topK 50: https://developers.cloudflare.com/changelog/post/2026-03-16-topk-limit-increased-to-50/
- Vectorize pricing: https://developers.cloudflare.com/vectorize/platform/pricing/

### Citation intent
- CiteFusion (Oct 2025): https://link.springer.com/article/10.1007/s11192-025-05418-8
- CiteFusion Zenodo: https://zenodo.org/records/15011985
- MF-Cite (Jul 2025): https://link.springer.com/article/10.1007/s11192-025-05365-4
- GLB-Cite (2026): https://www.sciencedirect.com/science/article/abs/pii/S0893608026004235

### Internal
- Gap matrix: `docs/ARGE_GAP_MATRIX_2026.md`
- Implement queue: `docs/ARGE_IMPLEMENT_QUEUE.md`
- Remaining work: `docs/REMAINING_WORK.md`
- Colab budget: `docs/COLAB_COMPUTE_BUDGET.md`
- QC: `.qc/latest-report.json`

---

*Final tur: scholarpulse-final kod tabanı (2026-05-25), QC raporu, plan frontmatter ve 2025–2026 web kaynakları ile üretilmiştir. Launch readiness % tahmini P0 kapı ağırlıklıdır; soft demo daha yüksek, hard launch daha düşük yorumlanabilir.*
