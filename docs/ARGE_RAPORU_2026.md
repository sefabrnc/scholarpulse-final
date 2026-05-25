# ScholarPulse Ar-Ge Raporu 2026

Tarih: 2026-05-24
Proje: scholarpulse-final
Ana plan: `c:/Users/sefab/.cursor/plans/tek_cümle_5184c22d.plan.md`
Kapsam: Citation graph, Colab compute, Cloudflare D1/Workers/Vectorize, PDF.js timeline

---

## Executive Summary

ScholarPulse'in **koordinat-tabanli, metin-saklamayan** mimarisi telif acisindan guclu ve rakiplerden (Scite, Elicit, Connected Papers) ayrisan bir UX sunuyor. Ancak May 2026 kod tabani incelemesinde **kritik bosluk**: Colab 8-pass pipeline iskeleti tamamlanmis, fakat embedding/reranker/intent modelleri **deterministik stub** (Jaccard skor + sozlesme cikti). Bu durumda `cite-quality-eval` gate'i sentetik CSV skorlariyla PASS gosteriyor; gercek precision >= 0.95 hedefi **henuz olculemedi**.

Onerilen strateji:
1. **Phase 1.5 (4-6 hafta)**: Gercek Qwen3/BGE model entegrasyonu, 200+ gercek etiketli cite cifti, 10 PDF coord-diff, observability typecheck fix.
2. **Phase 1.5 (devam)**: CiteFusion WS intent proxy shipped; Colab compute budget documented; 200+ gercek etiketli cite cifti, 10 PDF coord-diff.

Tahmini Phase 1 maliyet: ~$4-20/ay (Colab $0 + CF Free/Paid + Vectorize 1024 dim).

---

## 1. SOTA Benchmark Karsilastirmasi

### 1.1 Citation Matching / Verification (2025-2026)

ScholarPulse'in gorevi (kaynak cumle -> hedef paper cumlesi eslestirme) ile bibliyografik dogrulama (DOI/title var mi?) farkli problem siniflari.

| Sistem / Benchmark | Gorev | Precision | Recall | F1 | Not |
|---|---|---:|---:|---:|---|
| CiteGuard (RealCitationErrors-500) | Hallucinated cite tespiti | 0.82 | 0.97 | 0.89 | BM25->SPECTER + LLM judge |
| CITE-AI (4200 string) | exists ekseni | - | - | 0.81 | Lookup + fuzzy match |
| CITE-AI | attributable ekseni | - | - | 0.62 | En zor eksen |
| CiteAudit (6086 ref) | gercek+hallucinated | 0.861 | 1.000 | 0.925 | LLM tabanli tam framework |
| ScholarPulse hedefi | sentence-level cite edge | >=0.95 | - | - | CE threshold >=0.85, henuz olculmedi |

**Cikarim**: Bibliyografik lookup (DOI/title) yuksek recall, dusuk precision (title-fuzzy P=0.41). ScholarPulse'in **strict bib->DOI + CE reranker** yaklasimi dogru; ancak sentence-level eslestirme icin ayri benchmark gerekli (ACL-ARC/SciCite intent degil, **cross-paper sentence match**).

### 1.2 Embedding ve Reranker (Academic Text)

Kaynak: Qwen3 Embedding paper (arXiv:2506.05176), Qwen3 GitHub, BGE-M3 docs (Haziran 2025).

| Model | Param | MTEB (eng) | MTEB-R (rerank) | Dim | Lisans | T4 Uygun |
|---|---|---:|---:|---:|---|---|
| Qwen3-Embedding-0.6B | 0.6B | 61.82 | - | 1024 | Apache 2.0 | Evet |
| BGE-M3 | 0.6B | 59.56 | - | 1024 | MIT | Evet |
| Qwen3-Reranker-0.6B | 0.6B | - | 65.80 | - | Apache 2.0 | Evet |
| BGE-reranker-v2-m3 | 0.6B | - | 57.03 | - | MIT | Evet |
| gte-reranker-modernbert-base | 149M | - | ~83 Hit@1 | - | Apache 2.0 | Evet (8x kucuk) |
| NV-Embed-v2 | 7B | 70.58 | - | - | - | Hayir (Colab Pro+) |

**Cikarim**: Plan'daki Qwen3 ailesi tutarli semantic uzay saglar. Eval onceligi: **cite precision** (MTEB degil). Oneri: Qwen3-0.6B embed + gte-reranker-modernbert (hiz) veya Qwen3-Reranker-0.6B (tutarlilik) A/B test.

### 1.3 GROBID vs Alternatifler

| Arac | Corpus | Metrik | Deger | Kaynak |
|---|---|---|---:|---|
| GROBID (OOTB) | Is use-case | F1 | 0.89 | Tkaczyk et al. 2018 |
| CERMINE (OOTB) | Is use-case | F1 | 0.83 | Tkaczyk et al. 2018 |
| Anystyle | 56 PDF, 27 alan | Genel skor | en iyi | arXiv:2205.14677 |
| GROBID | 56 PDF, 27 alan | ref ID F1 | 0.54-0.85 (alan bagimli) | arXiv:2205.14677 |
| Qwen3-VL LoRA | SSH cok dilli | parsing micro-F1 | 0.855 vs GROBID 0.692 | arXiv:2603.13651 |

**Cikarim**: GROBID CS/biyomedik Ingilizce PDF'lerde guclu; alan/corpus bagimli. Plan'daki F1 0.87-0.90 iddiasi makul ama **corpus-spesifik**. Phase 1.5: GROBID primary + regex fallback dogru; Phase 2: temiz olmayan ref listeleri icin hibrit LLM routing (SSH paper'daki oneri).

### 1.4 PDF Koordinat Dogrulugu (PyMuPDF vs PDF.js)

| Konu | Bulgu | Risk |
|---|---|---|
| Koordinat sistemi | PDF: bottom-left origin; PyMuPDF/MuPDF: top-left | Orta - `transformation_matrix` gerekli |
| Font-size offset | MuPDF word bbox, font boyutuna gore tutarsiz offset | Yuksek - plan'daki union bbox kismen azaltir |
| Normalized coords | norm_x/y/w/h (0-1) renderer farklarini azaltir | Dusuk |
| Mevcut test | 15 fixture, mantik mirror (gercek PDF degil) | Yuksek - gate yetersiz |

PyMuPDF docs: `page.transformation_matrix` ile PDF<->MuPDF donusumu zorunlu.
MuPDF.js issue #151: bbox offset font-size/style'a bagli, uniform transform yetersiz.

**Cikarim**: `coord-diff-test` fixture PASS (15/15) yeterli degil. **10 gercek PDF** uzerinde PyMuPDF extract -> PDF.js render pixel diff <=1px gate'i Phase 1.5 cikis kriteri olmali.

### 1.5 Citation Intent Classification

| Model / Framework | Dataset | Macro-F1 | Not |
|---|---|---:|---|
| SciBERT (baseline) | ACL-ARC | ~0.54 | FineCite 2025 |
| Structural Scaffolds | ACL-ARC | 0.679 | Multitask |
| CiteFusion (SciBERT+XLNet) | SciCite | 0.896 | SOTA ensemble |
| CiteFusion | ACL-ARC | 0.762 | |
| SOFT + Qwen-Small | Cross-domain | en robust | arXiv:2601.05103 |
| ScholarPulse hedefi | 6-label | >=0.50 | CiteFusion WS proxy (SciCite HF) |

**Cikarim**: CiteFusion SciCite Macro-F1 0.896 (SOTA). Tam ensemble agirliklari HF'de yok;
pipeline `citefusion/scicite-ws` + WS-framed SciCite HF proxy (`lostelf/...`, F1 ~0.84) kullanir.
Tam agirliklar icin `SP_CITEFUSION_WEIGHTS_DIR` (paper web app). Detay: `docs/COLAB_COMPUTE_BUDGET.md`.

---

## 2. Rakip Feature Matrix

| Ozellik | Scite | Elicit | Conn. Papers | Res. Rabbit | Semantic Scholar | ScholarPulse (plan) | ScholarPulse (kod May 2026) |
|---|---|---|---|---|---|---|---|
| Citation intent | Paper-level Smart Citations | Sinirli | Yok | Yok | influentialCitationCount | Sentence+coord | Stub intent |
| Koordinat bbox snippet | Yok | Yok | Yok | Yok | Yok | Unique | API hazir, web PDF viewer eksik |
| Figure/table cite click | Yok | Yok | Yok | Yok | Yok | PdfOverlayLayer | API `/cite/elements` var |
| Visual cite graph | Yok | Yok | Graph (1 seed) | Graph (cok seed) | Yok | Timeline (no edges) | Timeline API + public page |
| AI Q&A | Assistant | Core | Yok | Yok | Yok | Ertelendi | - |
| Library import | Zotero | CSV | Manual | Zotero | Yok | BibTeX/RIS/JSON | API scaffold |
| TLDR summary | Yok | Evet | Yok | Yok | Evet (S2) | OpenAlex sync | Tamamlandi |
| Influential badge | Smart Citations | Yok | Yok | Yok | influential count | ce_score+intent | API badge |
| Feed/alerts | Evet | Evet | Yok | Yok | Alerts | In-app (no mail) | Feed API |
| Publisher lisansli full-text | 40+ publisher | Sinirli | Metadata only | Metadata | OA + API | Proxy stream (no persist) | PDF proxy DO |
| Veri guncelligi | Aktif | S2 aktif | Aktif | 2025 revamp+Litmaps | Aktif | OpenAlex nightly | OpenAlex sync OK |
| Mobil/PWA | Sinirli | Sinirli | Yok | App | App | PWA plan | manifest+sw var |
| Fiyat | Ucretli | Freemium | Freemium | Freemium+Premium | Ucretsiz | $0 stack hedefi | - |

**Rekabet bosluklari (firsat)**:
- Scite: publisher lisansli full-text okuma; biz runtime PDF proxy (telif guvenli ama throttling riski).
- Elicit: tablo/cikarim; biz coord-snippet daha guvenilir ama AI extraction yok.
- Connected Papers: tek seed limiti; biz cite-graph + coklu seed library.
- ResearchRabbit: discovery odakli; biz reading workflow + intent.

**Rekabet aciklari (risk)**:
- Scite 1.6B+ citation index + publisher anlasmalari -> veri derinligi.
- Semantic Scholar S2AG + SPECTER2 embeddings -> hazir altyapi.
- Elicit extraction -> tablo/claim cikarma bizde yok (Phase 3).

---

## 3. Teknik Risk Matrisi

| ID | Risk | Severity | Likelihood | Mitigation | Plan durumu |
|---|---|---|---|---|---|
| R1 | ML modelleri stub - gercek precision bilinmiyor | Kritik | Kesin | Qwen3/gte entegrasyon + gercek benchmark | colab-pipeline: loader shipped, Colab GPU dogrulama bekliyor |
| R2 | cite-quality-eval sentetik skorlarla PASS | Yuksek | Kesin | Gercek CE skorlariyla yeniden etiketle | cite-quality-eval in_progress |
| R3 | coord-diff fixture-only, gercek PDF test yok | Yuksek | Yuksek | 10 PDF pixel diff harness | coord-diff-test in_progress |
| R4 | GROBID alan-spesifik dusuk performans | Orta | Orta | Regex fallback + pending_bibs retry | Tamamlandi (fallback var) |
| R5 | Publisher PDF proxy ban/throttle | Yuksek | Orta | DO circuit breaker + CF cache 1h | circuit-breaker-dlq completed |
| R6 | D1 5GB limit (~160K paper) | Orta | Yuksek | Tier filter + Phase 3 R2 Parquet | Plan'da tanimli |
| R7 | Vectorize 1M paper (60 vec/paper = 60M vec) | Orta | Orta | doi_prefix shard, coklu index | 10M vec/index limit (Ocak 2026) yeterli tek index icin ~166K paper |
| R8 | SciBERT intent dusuk F1 (~0.55) | Orta | Yuksek | confidence_tier + "Possible" badge | SciCite fine-tune loader shipped; eval bekliyor |
| R9 | Observability typecheck fail | Orta | Kesin | FormDataEntryValue fix | observability-stack in_progress |
| R10 | Legacy Supabase cakismasi | Orta | Orta | legacy-cleanup task | pending |
| R11 | Colab Free disconnect / throttle | Orta | Yuksek | Kaggle 30h/week yedek + checkpoint Drive | Plan Colab Free onayli |
| R12 | Telif: vektor saklama | Dusuk | Dusuk | Koordinat-only + runtime render | Mimari dogru (Project Alexandria uyumlu) |
| R13 | OCR PDF skip (%30-50 arXiv) | Orta | Yuksek | Phase 3 PyMuPDF4LLM OCR | ocr-skip-policy completed |
| R14 | CF Queue DLQ vs D1 ingest_dlq ikili sistem | Dusuk | Orta | Tek DLQ gozlem paneli | Her ikisi de var, birlestir |

---

## 4. Maliyet / Dogruluk Trade-off Analizi

### 4.1 Compute (Colab vs Alternatifler)

| Platform | GPU | Ucretsiz limit | 160K paper tahmini | Maliyet |
|---|---|---|---|---|
| Colab Free T4 | 16GB | ~12h/session, disconnect | ~8 gun (4 paralel nb) | $0 |
| Colab Pro | T4/A100 | 100 CU/ay (~18.5h A100) | Pro'dan YAVAS | $10/ay |
| Kaggle | T4x2 | 30 GPU saat/hafta | Stabil batch | $0 |
| RunPod spot | A100 | Kredi yok (free tier yok) | Hizli ama ucretli | ~$0.80-1.64/hr |

**Karar dogrulama**: Plan'daki "Colab Pro ALMA" analizi dogru. **Oneri**: Primary Colab Free + secondary Kaggle (checkpoint sync) = en iyi $0 throughput.

### 4.2 Cloudflare Storage / Vectorize

| Olcek | D1 (cite metadata) | Vectorize (1024 dim) | Aylik tahmini |
|---|---|---|---|
| 100K paper | ~3.1 GB | 6M vec = 6.1B stored dims | ~$3-10 |
| 350K paper | ~10 GB (Paid D1) | 21M vec | ~$35 |
| 1M paper | D1 yetmez | 60M vec (6 index veya shard) | ~$100+ |

Vectorize fiyatlandirma (2026): stored dims $0.05/100M + query dims $0.01/1M.
Free tier: 5M stored dims, 30M queried dims/ay.

**Cikarim**: Phase 1 cap 160K paper D1 Free icinde. 1M hedefi Phase 3 R2 Parquet + hot/cold router zorunlu.

### 4.3 Dogruluk vs Maliyet

| Secenek | Precision tahmini | Maliyet | Oneri |
|---|---|---|---|
| Jaccard stub (mevcut) | Bilinmiyor (~0.6?) | $0 | Kaldirilmali |
| Qwen3-0.6B + gte-modernbert | ~0.85-0.92 (tahmin, eval gerekli) | $0 T4 | Phase 1.5 default |
| Qwen3-8B embed | +5-8% MTEB, cite precision belirsiz | Colab Pro/A100 | Phase 3 |
| SciBERT intent | F1 ~0.55 | $0 T4 | Fallback only |
| CiteFusion intent | F1 ~0.89 SciCite | $0 T4 inference | **Phase 1 default** (WS proxy + optional local weights) |
| GROBID + LLM bib | +10-16% parsing (SSH) | LLM API veya local 7B | Phase 2 hibrit |

---

## 5. Kod Tabani Gap Analizi (scholarpulse-final)

### 5.1 Tamamlanan / Guclu

| Alan | Kanit |
|---|---|
| Monorepo scaffold | apps/web, apps/api, packages/shared, colab/ |
| D1 schema + migrations | cite_nodes, cite_edges, paper_search, user_* |
| Bulk ingest API | `/api/cite/bulk-ingest`, chunking, idempotent UPSERT |
| PDF proxy + circuit breaker | DO rate limit, UA rotation |
| DLQ | ingest_dlq table + `/api/internal/dlq*` |
| Hybrid search | FTS5 + Vectorize RRF |
| Timeline API | `/api/cite/timeline` |
| Public routes | `/paper`, `/cite`, `/timeline`, `/search`, `/authors`, `/topics` |
| QC + user research workstreams | `.qc/`, `.user-research/`, docs |
| Eval harness iskeleti | coord_diff (15 fixture), citation_benchmark |

### 5.2 Riskli / Yanlis Yaklasim Olabilecek

| Todo | Durum | Sorun | Oneri |
|---|---|---|---|
| colab-pipeline-8pass | in_progress | Colab GPU uzerinde gercek weight dogrulama bekliyor | Loader + fallback shipped; cite-quality-eval gate |
| cite-quality-eval | in_progress | CSV'deki `score` sentetik; gercek pipeline degil | Pipeline'dan score uret, 200+ gercek etiket |
| coord-diff-test | in_progress | Fixture mirror test, gercek PDF yok | 10 PDF end-to-end test ekle |
| observability-stack | in_progress | API typecheck FAIL (FormDataEntryValue) | Hemen fix |
| legacy-cleanup | pending | Eski Supabase route cakismasi | Launch oncesi zorunlu |
| cf-pages-auth | completed | @supabase/ssr optional middleware + protected route list + .env.example shipped | OAuth callback exchange when Supabase project wired |
| standalone-web-sections | in_progress | Desk/canvas PDF viewer entegrasyonu eksik | User report: "no real PDF viewer" |
| Plan: 2880 paper/gun A100 | - | Colab Free T4 ile celisen throughput iddiasi | Success criteria guncelle: T4 bazli |
| Plan: precision >=0.95 | - | Stub ile olculemiyor | Phase 1.5 gate'e tasi |
| User flagging KALDIRILDI | - | Kalite geri bildirimi sadece admin | Phase 2'de sinirli "Report incorrect" dusun |

### 5.3 Beklemede / Ertelenmesi Dogru

| Todo | Gerekce |
|---|---|
| ai-qa-deferred | $0 stack + halusinasyon riski - dogru karar |
| phase3-deferred (50M, OCR, 8B embed) | D1/Vectorize limitleri |
| browser-extension | API badge hazir, extension Phase 2 |
| search-filters | Vectorize metadata filter + D1 join - dusuk oncelik |

---

## 6. Cloudflare Olceklendirme (100K - 1M Paper)

### D1

- Free: 5 GB/account, 500 MB/DB, 100 bound params/query
- Paid: 10 GB/DB, 1 TB/account
- ~31 KB/paper -> 160K paper (5 GB)
- 1M paper -> ~31 GB: **D1 tek DB yetmez**; doi_prefix shard veya multi-DB router

### Vectorize (Ocak 2026 guncelleme)

- Max 10M vectors/index (Paid)
- 1024 dim: 100K paper x 60 element = 6M vec (sigar)
- 1M paper x 60 = 60M vec -> **6 index** veya namespace shard
- Free tier: 200K vec/index, 5M stored dims total

### Workers

- 30s CPU, 100MB body -> bulk-ingest 50 paper/chunk dogru
- 1000 queries/invocation (Paid) -> timeline 1-hop OK

---

## 7. Telif / Copyright

| Veri tipi | Saklama | Telif riski | ScholarPulse |
|---|---|---|---|
| Paper full text | Server'da kalici | Yuksek | YOK (dogru) |
| Abstract | Server'da | Orta | YOK (dogru) |
| Embedding vektorleri | Vectorize | Dusuk-Orta | VAR (metadata only) |
| Koordinat (norm bbox) | D1 | Dusuk | VAR (factual fact) |
| Runtime snippet | Client PDF.js render | Dusuk (transient) | VAR (dogru) |
| TLDR (OpenAlex/S2) | D1 | Dusuk | VAR |

Project Alexandria (arXiv:2502.19413): TDM fair use arastirma icin desteklenir; **near-verbatim dagitim yasak**. Koordinat-only + runtime render stratejisi en guvenli spektrumda.

**Oneri**: Vektor metadata'da cumle metni **asla** saklama. `sentence_vectors` metadata: `{doi, page, sentence_id}` only (plan uyumlu).

---

## 8. Observability / Circuit Breaker / DLQ Best Practices

Cloudflare Queues (2025-2026 docs):
- `dead_letter_queue` + `max_retries` zorunlu
- DLQ consumer ayri Worker
- Metrikler: `backlog_count`, `lagTime`, `retryCount`, `outcome=dlq`
- Idempotent consumer (at-least-once delivery)

ScholarPulse mevcut:
- PDF proxy: DO circuit breaker (5x 429 -> 30dk open) - OK
- Ingest: D1 `ingest_dlq` tablosu - OK ama CF Queue DLQ ile cift sistem
- Observability: `x-trace-id`, Analytics Engine - typecheck fail

**Oneri**:
1. Tek dashboard: DLQ (D1 + Queue) birlestir
2. SLO alertleri: PagerDuty yerine once CF Notifications (ucretsiz)
3. Colab heartbeat `/api/internal/heartbeat` - 30dk timeout alert

---

## 9. Onerilen Phase-1.5 Yol Haritasi (4-6 hafta)

| Hafta | Is | Cikis kriteri |
|---|---|---|
| 1 | Qwen3-Embedding-0.6B + gte-modernbert entegrasyon (Colab) | Stub kaldirildi |
| 1 | Observability typecheck fix | `pnpm typecheck` green |
| 2 | 50 gercek cite cifti etiketle + eval pipeline bagla | Precision olcumu baslar |
| 2 | 10 PDF coord-diff gercek test | <=1px veya known-issue listesi |
| 3 | GROBID Docker Colab notebook + 20 paper bib recall olc | recall >=0.90 |
| 3 | legacy-cleanup tamamla | Eski Supabase route 0 |
| 4 | 200 etiketli cift + threshold sweep | precision >=0.92 (Phase 1 hedef) |
| 4-6 | Web PDF viewer + Timeline entegrasyon (desk) | End-to-end demo |
| 5-6 | Kaggle fallback notebook + Drive checkpoint | 24/7 ingest kapasitesi |

---

## 10. Onerilen Phase-2 Yol Haritasi (8-12 hafta)

| Alan | Is |
|---|---|
| Intent | CiteFusion WS shipped; optional full ensemble via SP_CITEFUSION_WEIGHTS_DIR |
| Bib parse | GROBID + LLM hibrit routing (temiz vs kirli PDF) |
| Discovery | Browser extension MVP ( Scholar/PubMed badge) |
| Search | Advanced filters (year, citations, topic) |
| Scale | doi_prefix shard tasarimi, Vectorize multi-index |
| OCR | PyMuPDF4LLM force_ocr (Phase 3 erken) |
| Quality | User "Report incorrect" (sinirli, admin review) |
| Integrations | Zotero OAuth sync |
| Eval | Aylik precision regression CI |

---

## 11. Acik Arastirma Sorulari

1. **Cross-paper sentence citation matching** icin public benchmark var mi? (ACL-ARC intent != match)
2. Qwen3-0.6B vs BGE-M3: cite precision A/B - hangi domainlerde fark?
3. Union bbox vs line-level bbox: cok satirli cumlelerde CE precision etkisi?
4. PDF.js OffscreenCanvas snippet render: mobil Safari uyumluluk?
5. OpenAlex `ids` field canonicalization: preprint->published edge case ornekleri?
6. Publisher ToS: runtime PDF proxy vs coordinate snippet - yasal gri alanlar?
7. Vectorize metadata filter performansi: 100K+ paper'da topic/year filter latency?
8. SciBERT 6-label vs Scite 3-label (support/contrast/mention) mapping UX?
9. Kaggle 30h/week + Colab Free paralel: optimal paper/saat throughput?
10. GROBID 0.8.0 vs 0.8.1+ TEI coordinate accuracy degisimi?

---

## 12. Kaynaklar

### Citation Matching / Verification
- CiteGuard: https://openreview.net/pdf?id=TKmxf2oSSR
- CITE-AI benchmark: https://clawrxiv.io/abs/2604.02008
- CiteAudit: https://arxiv.org/pdf/2602.23452
- BibTeX hallucination eval: https://arxiv.org/pdf/2604.03159v1

### Embeddings / Rerankers
- Qwen3 Embedding paper: https://arxiv.org/pdf/2506.05176
- Qwen3 GitHub: https://github.com/QwenLM/Qwen3-Embedding
- BGE-M3 docs: https://bge-model.com/bge/bge_m3.html

### Bibliography Parsing
- GROBID evaluation: https://arxiv.org/pdf/1802.01168
- Structured references tools: https://arxiv.org/pdf/2205.14677
- LLM vs GROBID SSH: https://app.argminai.com/arxiv-dashboard/papers/2603.13651v1

### PDF Coordinates
- PyMuPDF coordinate systems: https://pymupdf.readthedocs.io/en/latest/app3.html
- MuPDF/PDF.js coord issue: https://github.com/ArtifexSoftware/mupdf.js/issues/151

### Citation Intent
- SciCite / Structural Scaffolds: https://aclanthology.org/N19-1361.pdf
- CiteFusion: https://link.springer.com/article/10.1007/s11192-025-05418-8
- SOFT framework: https://arxiv.org/html/2601.05103v1
- FineCite: https://aclanthology.org/2025.findings-acl.1259.pdf

### Competitors
- Scite: https://scite.ai/
- ResearchRabbit 2025: https://www.researchrabbit.ai/announcement-researchrabbit-release-2025
- Litmaps vs RR vs CP: https://effortlessacademic.com/litmaps-vs-researchrabbit-vs-connected-papers-the-best-literature-review-tool-in-2025/
- Semantic Scholar API: https://www.semanticscholar.org/product/api/tutorial

### Cloudflare
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Vectorize limits: https://developers.cloudflare.com/vectorize/platform/limits/
- Vectorize 10M changelog: https://developers.cloudflare.com/changelog/post/2026-01-23-increased-index-capacity/
- Vectorize pricing: https://developers.cloudflare.com/vectorize/platform/pricing/
- Queues DLQ: https://developers.cloudflare.com/queues/configuration/dead-letter-queues/

### Compute
- Free GPU comparison 2026: https://runaicode.ai/best-free-gpu-resources-machine-learning-2026/
- Colab alternatives: https://www.thundercompute.com/blog/colab-alternatives-for-cheap-deep-learning-in-2025

### Legal
- Project Alexandria: https://arxiv.org/pdf/2502.19413
- Fair use LLM framework: https://aclanthology.org/2025.findings-emnlp.423.pdf

### Internal
- Ana plan: `c:/Users/sefab/.cursor/plans/tek_cümle_5184c22d.plan.md`
- Quality gates: `scholarpulse-final/docs/quality-gates.md`
- Colab pipeline: `scholarpulse-final/colab/pipeline/README.md`
- User research: `scholarpulse-final/.user-research/latest-user-report.json`

---

## 13. Oncelik Sirasi (Ozet)

1. **P0** - Colab stub modelleri -> gercek Qwen3/gte entegrasyonu
2. **P0** - Gercek cite benchmark (200+ etiketli cift, sentetik CSV kaldir)
3. **P0** - Observability typecheck fix
4. **P1** - 10 PDF coord-diff gercek test
5. **P1** - legacy-cleanup (Supabase route silme)
6. **P1** - Web desk PDF viewer + Timeline end-to-end
7. **P2** - Kaggle GPU yedek + Drive checkpoint
8. **P2** - GROBID Colab Docker production notebook
9. **P2** - Advanced search filters
10. **P3** - Browser extension, CiteFusion intent, OCR Phase 3

---

*Rapor scholarpulse-final kod tabani (May 2026), ana plan todo durumlari ve 2025-2026 web arastirmasi ile uretilmistir. Benchmark rakamlari kaynak makalelerden alinmistir; cite precision hedefleri henuz gercek pipeline ile dogrulanmamistir.*

---

## 14. Ar-Ge Tur 2 (2026-05-24)

### 14.1 Web arastirmasi ozeti (2025-2026)

**Frontend rakipler:**
- Scite: Smart Citations (support/contrast/mention), browser extension, Zotero plugin, MCP/Claude connector (2026) — https://scite.ai/ , https://www.newswise.com/articles/research-solutions-launches-scite-mcp-connecting-chatgpt-claude-other-ai-tools-to-scientific-literature
- Elicit: structured extraction + systematic review; citation intelligence yok — https://paperguide.ai/blog/elicit-vs-scite/
- Connected Papers / ResearchRabbit / Litmaps: visual discovery; intent/coord yok — https://effortlessacademic.com/litmaps-vs-researchrabbit-vs-connected-papers-the-best-literature-review-tool-in-2025/
- Browser extension pattern: MV3 service worker cache + content script row injection (Scite/Ibid pattern)

**Backend/pipeline:**
- Citation matching SOTA: bibliyografik lookup != sentence-level match; precision-first CE gate dogru
- GROBID vs LLM: temiz Ingilizce PDF GROBID; SSH footnote/multilingual LLM routing — https://arxiv.org/html/2603.13651v1
- Vector stack: Qwen3-0.6B + gte-reranker-modernbert ($0 T4) oncelikli
- CF D1: batch writes, read replication read-heavy icin — https://dev.to/whoffagents/cloudflare-d1-serverless-sqlite-at-the-edge-production-patterns-4nap
- CF observability: Workers Logs JSON + head_sampling_rate; Tail Worker -> Analytics Engine — https://developers.cloudflare.com/workers/observability/logs/workers-logs/

### 14.2 Kod audit + QC (May 2026 tur 2)

| Alan | Durum |
|---|---|
| API typecheck/build | GREEN (QC) |
| Web typecheck | GREEN (`tsc --noEmit` 2026-05-24) |
| Web build | Compiled OK; pages-manifest ENOENT arada (P0) |
| Colab pipeline | Stub Jaccard reranker (P0) |
| Eval cite-quality | Sentetik CSV; gercek olcum yok (P0) |
| Public pages | OpenAlex proxy; influential badge batch eklendi |

QC onceki: 47 finding (12 error, 20 bottleneck, 15 logic). Public route fallback-only ve search N+1 badge QC gurultusu azaltildi.

### 14.3 Bu tur implement edilenler ($0, <200 satir)

1. `POST /api/papers/badges` — batch influential badge (max 20 DOI)
2. Search page batch badge hook (`usePaperBadgesBatch`)
3. Colab `SP_CE_THRESHOLD` default 0.85 (plan parity)
4. QC skip prefix: public routes fallback-only false positive

### 14.4 Yeni dokumanlar

- `docs/ARGE_GAP_MATRIX_2026.md` — 29 gap, severity tablosu
- `docs/ARGE_IMPLEMENT_QUEUE.md` — P0-P3 + YAPMA listesi + runbook

### 14.5 Gap sayilari (tur 2)

| Severity | Adet |
|---|---:|
| P0 | 3 |
| P1 | 7 |
| P2 | 11 |
| P3 | 2 |
| TRAP | 6 |
