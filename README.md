# ScholarPulse Final - Week 1 Foundation

This repository contains the Week-1 monorepo foundation for the new sibling project.
It keeps the previous project untouched and starts from a clean structure focused on:

- Cloudflare Worker API skeleton (`apps/api`)
- Next.js web shell for Cloudflare Pages (`apps/web`)
- Shared type placeholders (`packages/shared`)
- Colab pipeline placeholders (`colab/pipeline`)

## Project Tree

```text
scholarpulse-final/
  apps/
    api/
      migrations/
        0001_init.sql
      src/
        index.ts
      package.json
      tsconfig.json
      wrangler.toml
    web/
      app/
        layout.tsx
        page.tsx
      next-env.d.ts
      next.config.mjs
      package.json
      tsconfig.json
  colab/
    pipeline/
      README.md
  packages/
    shared/
      src/
        index.ts
      package.json
      tsconfig.json
  .gitignore
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

## Commands

From repository root:

- `pnpm install` - install all workspace dependencies
- `pnpm dev:api` - run Cloudflare Worker API locally with Wrangler
- `pnpm dev:web` - run Next.js web app locally
- `pnpm typecheck` - run TypeScript checks across packages
- `pnpm build` - run package build scripts
- `pnpm qc:run` - run independent QC pipeline and write `.qc/latest-report.json`
- `pnpm qc:report` - print latest QC summary in terminal
- `pnpm qc:open` - open QC report page URL hint (`/qc-report`)

## Independent QC Procedure

Use this flow after every completed workstream/subagent output to keep quality checks idempotent and repeatable:

1. Run `pnpm qc:run` from repository root.
2. Confirm report output exists at `.qc/latest-report.json`.
3. Open `http://localhost:3000/qc-report` (or run `pnpm qc:open`) for categorized findings:
   - Errors
   - Bottlenecks
   - Logic Risks
   - Passed Checks
4. Use `.qc/ownership-map.json` to route each finding to owner/workstream and linked todo id.
5. Update the plan todo status and related tasks based on the newest QC report.

This QC runner is safe to rerun and always overwrites only the latest report file.

## Quality Gates

- Gate docs: `docs/quality-gates.md`
- Coord diff harness:
  - `python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0`
- Citation precision harness:
  - `python eval/citation_benchmark/evaluate_precision.py --min-precision 0.95`
- API type safety / observability helper compile check:
  - `pnpm --filter @scholarpulse/api typecheck`

## Web Environment Variables (Cloudflare Pages)

Copy `apps/web/.env.example` and set:

- `SCHOLARPULSE_API_BASE_URL` — Worker base URL for API route proxies (local: `http://127.0.0.1:8787`)
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` — optional Supabase SSR auth (`middleware.ts` + `/auth/callback`)
- `SP_REQUIRE_AUTH` — `0` (default) or `1` to gate protected app sections
- `NEXT_PUBLIC_SITE_URL` — absolute site URL for sitemap/SEO

Public routes (`/authors/*`, `/topics/*`, `/paper/*`, etc.) proxy Worker first with OpenAlex fallback via `/api/public/*`.

Feed page merges nightly `/api/feed` with hybrid `/api/recommend` (semantic + citation-graph sections).

See `apps/web/README.md` for full route mapping and auth setup.

## API Environment Variables

Set these for `apps/api`:

- `COLAB_INGEST_TOKEN` - required token for `/api/cite/bulk-ingest` (`x-ingest-token` header)
- `DB` - D1 binding configured in `apps/api/wrangler.toml`

For local dev with Wrangler, you can set `COLAB_INGEST_TOKEN` in `.dev.vars` under `apps/api/`.

## D1 Migrations

From repository root:

- Local apply:
  - `pnpm --filter @scholarpulse/api exec wrangler d1 migrations apply scholarpulse_d1 --local`
- Remote apply:
  - `pnpm --filter @scholarpulse/api exec wrangler d1 migrations apply scholarpulse_d1 --remote`

## API Endpoints (Core)

- `POST /api/cite/bulk-ingest` - token-protected bulk upsert for `cite_nodes`, `cite_edges`, `paper_search`
- `POST /api/papers/upload` - user PDF upload queue (50 MB, optional R2 transient storage)
- `POST /api/library/import` - BibTeX/RIS DOI import into `user_library`
- `GET /api/resolve?id=...` - DOI/arXiv quick resolve with pending ingest fallback
- `GET /api/search?q=...&limit=...` - FTS + Vectorize hybrid search (`paper_search.tldr` when synced)
- `GET /api/cite/timeline?id=...&limit=...` - 1-hop citation timeline cards
- `GET /api/pdf/proxy?url=...` - allowlisted PDF/DOI proxy with cache headers

## Setup Guides

- **Colab CE + Cloudflare (TR, step-by-step):** [`docs/KURULUM_REHBERI_COLAB_CF.md`](docs/KURULUM_REHBERI_COLAB_CF.md)

## Notes

- D1 migration is metadata-first and avoids paper body/snippet text storage.
- API handlers return standardized errors as `{ "error": { "code": "...", "message": "..." } }`.
