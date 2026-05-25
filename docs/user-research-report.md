# User Research Report (2024-2026)

Generated: 2026-05-24  
Structured source: `.user-research/latest-user-report.json`  
Live view: `/user-report` in `apps/web`

## Method

- Web research on Elicit, Scite, Connected Papers, ResearchRabbit, Zotero, Semantic Scholar (2024-2026).
- Workflow literature: WisPaper, Scholar Inbox (ACL 2025), Semantic Reader (AI2).
- Code audit of `scholarpulse-final`: web pages, Worker API, Colab pipeline, QC report.
- Items marked **assumption** in JSON were not validated with ScholarPulse user interviews.

## Personas

| Persona | Primary jobs | Tools today |
|---------|--------------|-------------|
| PhD student | Discover, trace cites, organize, write related work | Zotero, Semantic Scholar, Connected Papers, Elicit |
| PI / lab lead | Monitor field, assess claim survival, share lists | Scite, Scholar alerts, Zotero groups |
| Industry researcher | Fast triage, export, share links | Elicit, Semantic Scholar, extensions |

## Market pain points (web research)

1. **Workflow fragmentation** -- discovery, library, and alerts live in separate tools (WisPaper 2025).
2. **Library import pain** -- Zotero migrations lose folders, attachments, annotations; large imports need chunking.
3. **Feed cold start** -- personalized feeds need onboarding (Scholar Inbox ACL 2025).
4. **Scite vs Elicit gap** -- context without discovery, or discovery without reliable extraction.
5. **AI extraction limits** -- complex tables, OCR PDFs, non-English (Elicit 2026 reviews).
6. **Graph tool limits** -- single-seed graphs, stale corpora, server overload (Connected Papers, ResearchRabbit).
7. **PDF mobile/a11y** -- static PDF friction on small screens and assistive tech (Semantic Reader).
8. **Search filter depth** -- uneven coverage and coarse filters (Semantic Scholar 2025).

## Code maturity vs plan

| Area | Status |
|------|--------|
| Worker API | Broad coverage (search, timeline, feed, annotations, collections, public routes) |
| Web app | Desk/timeline scaffold; section pages minimal; **no real PDF viewer** |
| Colab | 8-pass skeleton; **ML models stubbed** |
| QC | typecheck/build failing for api + web |
| Public pages | Worker routes exist; **web public routes missing in final** |
| cite/elements | **Web mock only**; not in Worker index |

## Top 10 user friction points

| # | Issue | Severity | Persona | Todo |
|---|-------|----------|---------|------|
| 1 | Desk uses PDF placeholder, not PDF.js | critical | all | `pdf-render-optimization` |
| 2 | Auth is demo localStorage, no Supabase gate | critical | PhD, PI | `cf-pages-auth` |
| 3 | No Zotero/BibTeX import | high | PhD, PI | `bib-rs-import` |
| 4 | Timeline trust opaque (no intent/confidence UI) | high | PI, industry | `citation-intent-pipeline` |
| 5 | Feed cold start / opaque relevance | high | PhD, PI | `feed-system` |
| 6 | Annotations detached from PDF | high | PhD, PI | `annotations-system` |
| 7 | cite/elements missing on Worker (mock overlay) | high | PhD, PI | `pdf-overlay-layer` |
| 8 | Build/typecheck failing | high | all | `standalone-web-sections` |
| 9 | PDF load/throttle UX missing | medium | PhD, industry | `pdf-proxy-worker` |
| 10 | Mobile split-view not usable | medium | PhD, industry | `dark-mode-pwa` |

## Top 10 unmet wants (not fully met)

| # | Want | State | Todo |
|---|------|-------|------|
| 1 | Zotero/BibTeX import with folders | pending | `bib-rs-import` |
| 2 | Real PDF + marker click + split sync | scaffold | `split-view-auto` |
| 3 | Sentence-level citation intent badges | in progress | `citation-intent-pipeline` |
| 4 | Personal PDF upload | pending | `pdf-upload-ingest` |
| 5 | Daily feed with clear match reasons | api-ready | `feed-system` |
| 6 | TLDR on paper cards | pending | `tldr-summary` |
| 7 | Browser extension on Scholar/PubMed | pending | `browser-extension` |
| 8 | Figure/table click timeline | partial mock | `figure-table-cite-detection` |
| 9 | Advanced search filter UI | api-only | `search-filters` |
| 10 | Continue where left off | api in progress | `reading-sessions` |

## Workflow gap matrix

```
discover  -> API strong, UI weak (no /search page)
read      -> CRITICAL gap (placeholder PDF)
cite      -> Timeline exists; trust badges missing
organize  -> Collections yes; import no
annotate  -> CRUD yes; PDF overlay no
monitor   -> Interests yes; saved-search UX thin
share     -> Worker public yes; web public no
```

## Recommended next sprint (2 weeks)

**Theme: Trustworthy Read-and-Import Loop**

| P | Task | Owner | Todo |
|---|------|-------|------|
| 1 | Fix web/api build blockers | web-platform | `standalone-web-sections` |
| 2 | Real PDF.js desk + markers | web-platform | `pdf-render-optimization` |
| 3 | Supabase auth middleware | web-platform | `cf-pages-auth` |
| 4 | Worker cite/elements + timeline badges | api-platform | `pdf-overlay-layer` |
| 5 | BibTeX/RIS import MVP | api-platform | `bib-rs-import` |
| 6 | Feed onboarding + explainability | web-platform | `feed-system` |
| 7 | Intent/confidence on timeline cards | ml-pipeline | `citation-intent-pipeline` |
| 8 | Annotation overlay on PDF | web-platform | `annotations-system` |

## Competitive position

**Unique strengths**

- Coord-based timeline + auto split sync (no visible edges)
- Figure/table overlay to timeline (when wired)
- No full paper text on server

**Parity gaps**

- Zotero import, browser extension, TLDR, production PDF viewer, public web pages

## Assumptions (not user-tested)

- Mobile/offline expectations inferred from Semantic Reader and competitor PWAs.
- Timeline trust sensitivity inferred from Scite/Elicit trust models.
- Persona split inferred from competitor reviews, not ScholarPulse interviews.
