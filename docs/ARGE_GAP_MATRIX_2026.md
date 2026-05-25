# ScholarPulse Ar-Ge Gap Matrix 2026

Tarih: 2026-05-25 (Final Ar-Ge turu)
Proje: scholarpulse-final
Kaynak: kod audit + QC + 2025-2026 web arastirmasi + `docs/ARGE_FINAL_2026.md`

Severity: P0 (launch blocker) | P1 (competitive gap) | P2 (quality debt) | P3 (nice-to-have) | TRAP (over-engineering)

| Gap | Severity | Competitor ref | Our status | Recommended action | Effort | Cost |
|---|---|---|---|---|---:|---:|
| Colab GPU E2E dogrulanmadi (local stub) | P0 | Scite Smart Citations, Elicit rerank | Loader shipped; smoke_test stub path; `v1-colab-ml` GPU kaniti yok | Colab T4 oturumu: PDF→bulk POST→D1/Vectorize; algorithm_version=v1-colab-ml | L | $0 |
| Cite precision gercek olculemiyor | P0 | CiteGuard/CITE-AI benchmark | `labeled_pairs.real.csv` yok; sentetik CSV blocked | 200+ admin etiket + pipeline CE score import; precision >=0.92 gate | M | $0 |
| Scite MCP agent entegrasyonu | P1 | https://scite.ai/blog/introducing-scite-mcp | REST API var; MCP/agent yok | Phase 2: public cite/timeline API doc; MCP TRAP Phase 1 | L | $0 |
| Gercek PDF coord-diff test yok | P1 | - | 15 fixture mirror PASS; 10 PDF pixel diff yok | eval/coord_diff pdf_cases gercek PDF ile doldur | M | $0 |
| Scite publisher full-text + MCP | P1 | https://scite.ai/ , https://www.newswise.com/articles/research-solutions-launches-scite-mcp-connecting-chatgpt-claude-other-ai-tools-to-scientific-literature | Runtime PDF proxy (telif guvenli); MCP yok | Phase 2: Zotero plugin parity; MCP ertele | L | $0-$$ |
| Elicit tablo/claim extraction | P1 | https://paperguide.ai/blog/elicit-vs-scite/ | Coord-snippet var; structured extraction yok | Phase 2: table markdown export + manual column (AI extraction TRAP) | L | $0 |
| Connected Papers coklu seed graph | P1 | Connected Papers | Timeline 1-hop, no edges (bilincli) | Library multi-seed timeline (deterministik) | M | $0 |
| ResearchRabbit discovery + Litmaps entegrasyon | P1 | https://www.researchrabbit.ai/ , https://effortlessacademic.com/litmaps-vs-researchrabbit-vs-connected-papers-the-best-literature-review-tool-in-2025/ | Feed + recommend API var; visual discovery zayif | Smart recommend UI polish; author co-graph | M | $0 |
| Semantic Scholar S2AG hazir embedding | P1 | https://www.semanticscholar.org/product/api/tutorial | OpenAlex sync; SPECTER2 yok | OpenAlex + kendi Vectorize yeterli Phase 1 | - | $0 |
| GLB-Cite intent SOTA (2026) | P2 | https://www.sciencedirect.com/science/article/abs/pii/S0893608026004235 | CiteFusion WS proxy (SciCite F1 89.6%) | Eval sonrasi A/B; Phase 1 CiteFusion yeterli | M | $0 |
| Undermind agentic lit review | P1 | Undermind.ai | Deterministic intent badges; agent yok | Phase 3 agent (TRAP simdi) | XL | $$ |
| Search N+1 badge fetch | P2 | Scite extension badges | Tekil /badge x20 | **DONE 2026-05-24:** POST /api/papers/badges batch | S | $0 |
| Public route OpenAlex fallback QC noise | P2 | - | QC fallback-only 14 bulgu | **DONE 2026-05-24:** QC skip prefix public routes | S | $0 |
| CE threshold plan uyumsuzlugu (0.87 vs 0.85) | P2 | Plan gate 0.85 | config 0.87 default | **DONE 2026-05-24:** SP_CE_THRESHOLD default 0.85 | S | $0 |
| pdfjs-dist legacy import typecheck | P2 | - | types/pdfjs-dist-legacy.d.ts ile green | Koru; pdfjs major bump'ta yeniden test | S | $0 |
| Browser extension Scholar/PubMed row inject | P2 | Scite extension | MV3 scaffold + DOI badge | content script row injection Phase 2 | M | $0 |
| PWA offline PDF cache eviction | P2 | web.dev offline-data | IndexedDB LRU 500MB; persist() yok | navigator.storage.persist() opt-in UX | S | $0 |
| Web production build flaky (Windows) | P2 | - | QC 2026-05-24: typecheck+build green; arada .next ENOENT | 3x CI build gate + flake runbook (quality-control-work) | S | $0 |
| D1 unbounded SELECT heuristics | P2 | CF D1 limits | QC 8 unbounded query uyarisi (medium) | Hot path LIMIT audit (timeline/search OK) | M | $0 |
| Vectorize topK=50 firsati | P2 | CF changelog Mar 2026 | recommend topK eski limit | /api/recommend topK artirimi A/B | S | $0 |
| GROBID kirli SSH PDF | P2 | arXiv:2603.13651 | GROBID primary + regex fallback | Phase 2 hibrit routing (temiz vs kirli) | M | $0 |
| CF Queue + D1 cift DLQ | P2 | CF Queues DLQ docs | Her ikisi var | Tek dashboard view (admin) | S | $0 |
| Supabase SSR auth tam entegrasyon | P2 | - | middleware stub | @supabase/ssr install + JWKS test | M | $0 |
| Zotero OAuth sync | P3 | Scite Zotero plugin | BibTeX import var | Phase 1.5 OAuth | M | $0 |
| OCR scanned PDF | P3 | - | skip policy | Phase 3 PyMuPDF4LLM force_ocr | L | $0 |
| 50M paper sharding | TRAP | - | Phase 3 deferred | YAPMA simdi | XL | $$ |
| LLM Q&A paid API | TRAP | Elicit/Scite AI | cancelled todo | YAPMA Phase 1 | XL | $$ |
| Full microservices split | TRAP | - | Monorepo CF Workers | YAPMA | XL | $$ |
| Complex admin dashboard v1 | TRAP | - | DLQ internal routes | Minimal /api/internal/* yeterli | L | $0 |
| Qwen3-8B embed upgrade | TRAP | MTEB +5-8% | 0.6B yeterli T4 | Eval sonrasi karar | L | $0-$$ |
| Real-time WebSocket cite graph | TRAP | - | REST + polling | YAPMA | L | $0 |

## Ozet sayilar (2026-05-25 final tur)

| Severity | Adet |
|---|---:|
| P0 | 2 |
| P1 | 8 |
| P2 | 12 |
| P3 | 2 |
| TRAP | 6 |
| **Toplam gap** | **30** |

## Rakip UX pattern notlari (2025-2026)

### PDF viewer / coord highlight
- PDF.js: `viewport.convertToViewportRectangle` + `pagerendered` sonrasi overlay (Stack Overflow / Mozilla gist pattern)
- Percent (0-1 top-left) normRect bizde dogru yaklasim; zoom'da overlay ve canvas ayni scale paylasilmali
- Split view: iki viewer ayni pairColor + sync pulse (bizde shipped)

### PWA / offline
- IndexedDB PDF binary + service worker app shell (web.dev offline-data)
- `navigator.storage.persist()` ile eviction riski azaltma
- Full-text server saklama yok — bizim model uyumlu

### Browser extension
- MV3: content script badge injection (Scite Scholar/PubMed pattern)
- `chrome.identity` OAuth + `/api/papers/:doi/badge` (bizde scaffold)
- Zotero 7 plugin kolonlari: supporting/contrasting/mentioning (Scite parity hedefi)

### Backend / pipeline SOTA
- Precision-first: strict bib->DOI + CE reranker (CiteGuard/CITE-AI attributable ekseni zor)
- GROBID OOTB CS/biyomedik; SSH footnote/multilingual icin LLM routing (arXiv:2603.13651)
- Vector stack: Qwen3-0.6B + gte-reranker-modernbert veya Qwen3-Reranker A/B ($0 T4)
- CF: D1 batch writes + Vectorize metadata index once upsert oncesi (CF docs)

## Kaynaklar

- Scite vs Elicit 2026: https://paperguide.ai/blog/elicit-vs-scite/
- Scite MCP 2026: https://www.newswise.com/articles/research-solutions-launches-scite-mcp-connecting-chatgpt-claude-other-ai-tools-to-scientific-literature
- GROBID vs LLM SSH: https://arxiv.org/html/2603.13651v1
- PDF.js overlay: https://stackoverflow.com/questions/27830725/add-html-css-overlays-by-text-location-on-pdf-document-when-rendering-in-pdf-js
- PWA offline: https://web.dev/learn/pwa/offline-data
- CF D1 patterns: https://dev.to/whoffagents/cloudflare-d1-serverless-sqlite-at-the-edge-production-patterns-4nap
- CF Vectorize metadata: https://developers.cloudflare.com/vectorize/reference/metadata-filtering/
- Internal QC: `.qc/latest-report.json`
- Internal Ar-Ge: `docs/ARGE_RAPORU_2026.md` | `docs/ARGE_FINAL_2026.md`
- Scite MCP 2026: https://scite.ai/blog/introducing-scite-mcp
- GLB-Cite 2026: https://www.sciencedirect.com/science/article/abs/pii/S0893608026004235
- Vectorize topK 50: https://developers.cloudflare.com/changelog/post/2026-03-16-topk-limit-increased-to-50/
