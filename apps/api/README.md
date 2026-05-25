# @scholarpulse/api

Cloudflare Worker API for ScholarPulse core ingestion and retrieval endpoints.

> **Deploy + D1/Vectorize kurulum (TR):** [`docs/KURULUM_REHBERI_COLAB_CF.md`](../../docs/KURULUM_REHBERI_COLAB_CF.md)

## Required Environment Variables

- `COLAB_INGEST_TOKEN`: expected token for `POST /api/cite/bulk-ingest` via `x-ingest-token`
- `INTERNAL_API_TOKEN`: optional dedicated token for `/api/internal/*` routes (falls back to `COLAB_INGEST_TOKEN`)
- `LOG_LEVEL`: optional structured log verbosity (`debug`, `info`, `warn`, `error`; default `info`)
- `LOG_FORMAT`: optional log output format (`json` default, `plain` for basic line logs)
- `DB`: D1 binding (configured by Wrangler from `wrangler.toml`)

For local development, create `apps/api/.dev.vars`:

```bash
COLAB_INGEST_TOKEN=replace-with-strong-token
```

## Local Run

From repository root:

```bash
pnpm install
pnpm --filter @scholarpulse/api dev
```

## Migrations

From repository root:

```bash
pnpm --filter @scholarpulse/api exec wrangler d1 migrations apply scholarpulse_d1 --local
pnpm --filter @scholarpulse/api exec wrangler d1 migrations apply scholarpulse_d1 --remote
```

## Implemented Routes

- `GET /health`
- `GET /api/internal/vectorize-indexes`
- `GET /api/internal/active-users`
- `GET /api/internal/edges-to-revalidate`
- `POST /api/internal/revalidate-edges`
- `POST /api/internal/edges-update`
- `POST /api/internal/revalidation-cron/run`
- `POST /api/internal/feed-generate`
- `GET /api/internal/ingest-log`
- `POST /api/internal/pending-bibs/retry`
- `POST /api/internal/pending-bibs/complete`
- `GET /api/internal/incoming-citations`
- `GET /api/internal/ingest-queue`
- `POST /api/cite/bulk-ingest`
- `POST /api/paper/bulk-upsert`
- `POST /api/internal/openalex/bulk-upsert`
- `GET /api/search`
- `GET /api/cite/timeline`
- `GET /api/authors/:name`
- `GET /api/authors/:name/coauthors`
- `GET /api/authors/:name/cites`
- `GET /api/topics/:name/evolution`
- `GET /api/topics/:name/papers`
- `GET /api/recommend`
- `GET /api/user/interests`
- `PUT /api/user/interests`
- `GET /api/feed`
- `PATCH /api/feed/:id/seen`
- `POST /api/cite/edges/:id/report`
- `POST /api/annotations`
- `GET /api/annotations`
- `PATCH /api/annotations/:id`
- `DELETE /api/annotations/:id`
- `POST /api/sessions/update`
- `GET /api/sessions/latest`
- `DELETE /api/user/me`
- `POST /api/saved-searches`
- `GET /api/saved-searches`
- `DELETE /api/saved-searches/:id`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `POST /api/collections`
- `GET /api/collections`
- `PATCH /api/collections/:id`
- `DELETE /api/collections/:id`
- `POST /api/collections/:id/papers`
- `DELETE /api/collections/:id/papers/:doi`
- `GET /api/export/library?format=bibtex|ris|json`
- `GET /api/export/cite-subgraph?id=...&format=bibtex|ris|json`
- `GET /api/resolve?id=doi:...|arxiv:...|url`
- `POST /api/papers/upload`
- `GET /api/papers/upload-status/:id`
- `POST /api/library/import`
- `GET /api/public/paper/:doi`
- `GET /api/public/cite/:id`
- `GET /api/public/timeline/:id`
- `GET /api/public/search`
- `GET /api/pdf/proxy`

## Endpoint Parameters

### `GET /api/search`

Hybrid retrieval with D1 FTS + Vectorize RRF (`k=60`).

Query params:

- `q` (required): search query, min 2 chars.
- `limit` (optional): default `20`, max `50`.
- `year_from` / `year_to` (optional): integer year filters.
- `min_citations` (optional): minimum citation threshold (`rank_signal` based).
- `journal` (optional): exact venue filter.
- `author` (optional): case-insensitive author contains filter.
- `topic` (optional): case-insensitive topic contains filter.
- `query_vector` (optional): comma-separated numeric embedding values.
  - If missing, worker attempts to use an optional AI binding for query embedding.

Example:

```bash
curl "http://127.0.0.1:8787/api/search?q=transformer&year_from=2018&year_to=2024&min_citations=10&journal=NeurIPS&author=Vaswani&topic=attention&limit=20"
```

### `GET /api/cite/timeline`

1-hop bidirectional timeline over `cite_edges`, joined with `cite_nodes` + `paper_search`.

Query params:

- `id` (required): source node id.
- `plan` or `tier` (optional): `free` or `pro`.
  - `free` limit cap: `10`
  - `pro` limit cap: `100`
- `limit` (optional): requested max item count, capped by plan tier.

Example:

```bash
curl "http://127.0.0.1:8787/api/cite/timeline?id=node_123&plan=pro&limit=50"
```

### `POST /api/paper/bulk-upsert`

OpenAlex sync consumer endpoint for `paper_search`, `paper_authors`, and `paper_topics`.

Auth:

- `Authorization: Bearer <COLAB_INGEST_TOKEN>` or `x-ingest-token: <COLAB_INGEST_TOKEN>`

Payload:

- `papers[]`: upserts `cite_nodes` + `paper_search` core metadata.
- `authors[]`: upserts `paper_authors` rows.
- `topics[]`: upserts `paper_topics` rows.

Example:

```bash
curl -X POST "http://127.0.0.1:8787/api/paper/bulk-upsert" \
  -H "Authorization: Bearer $COLAB_INGEST_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "papers": [
      {
        "nodeId": "w_123",
        "source": "openalex",
        "sourceRef": "https://openalex.org/W123",
        "title": "Attention Is All You Need",
        "doiNorm": "10.5555/3295222.3295349",
        "publicationYear": 2017,
        "venue": "NeurIPS",
        "rankSignal": 12345
      }
    ],
    "authors": [
      {
        "nodeId": "w_123",
        "authorId": "a_1",
        "authorName": "Ashish Vaswani",
        "authorOrder": 1
      }
    ],
    "topics": [
      {
        "nodeId": "w_123",
        "topic": "transformers",
        "score": 0.99
      }
    ]
  }'
```

### Internal Cron Helpers (`/api/internal/*`)

Token auth:

- `Authorization: Bearer <INTERNAL_API_TOKEN>` (or `COLAB_INGEST_TOKEN` fallback)
- `x-ingest-token` header is also accepted.

Available operational routes:

- `GET /api/internal/vectorize-indexes` (binding and env-level vector index readiness)
- `GET /api/internal/active-users?cursor=&limit=`
- `GET /api/internal/edges-to-revalidate?cursor=&limit=`
- `POST /api/internal/revalidate-edges` (`updates[]` payload with `status` / `algorithmVersion` / `confidenceTier` etc.)
- `POST /api/internal/edges-update` (alias for same batch update behavior)
- `POST /api/internal/revalidation-cron/run?limit=&max_pages=` (manual deterministic cron run)
- `POST /api/internal/feed-generate` (`items[]` payload with `userId` and `nodeId` or `doi`)
- `GET /api/internal/ingest-log?status=&cursor=&limit=`
- `POST /api/internal/pending-bibs/retry` (`ids[]` optional, otherwise pulls due queue)
- `POST /api/internal/pending-bibs/complete` (`ids[]` and/or `target_dois[]` — marks queue rows `completed` after Colab ingest)
- `GET /api/internal/incoming-citations?target_doi=` (cross-paper placeholder edges pointing at a DOI)
- `GET /api/internal/ingest-queue` (poll `pending_bibs` + `pdf_uploads` for Colab batch runner)
- `POST /api/internal/openalex/bulk-upsert` (internal-token protected OpenAlex bulk consumer)

### `GET /api/internal/vectorize-indexes`

Checks runtime readiness for `PAPER_VECTORS` + `SENTENCE_VECTORS`.

Auth:

- `Authorization: Bearer <INTERNAL_API_TOKEN>` (or `COLAB_INGEST_TOKEN` fallback)

Returns:

- binding presence for each index
- configured index names from environment variables
- `ok=false` with `500` when any required piece is missing

### `GET /api/authors/:name`

Author-centric paper listing backed by `paper_authors` + `paper_search`.

Params:

- `:name` (required): author name fragment.
- `limit` (optional): default `20`, max `50`.

Example:

```bash
curl "http://127.0.0.1:8787/api/authors/vaswani?limit=20"
```

### `GET /api/authors/:name/coauthors`

Returns co-author frequency distribution.

Params:

- `:name` (required): author name fragment.
- `limit` (optional): default `30`, max `100`.

Example:

```bash
curl "http://127.0.0.1:8787/api/authors/vaswani/coauthors?limit=25"
```

### `GET /api/authors/:name/cites`

Returns author-to-author citation neighbors via `cite_edges`.

Params:

- `:name` (required): author name fragment.
- `direction` (optional): `outbound` (default), `inbound`, or `all`.
- `limit` (optional): default `30`, max `100`.

Example:

```bash
curl "http://127.0.0.1:8787/api/authors/vaswani/cites?direction=all&limit=30"
```

### `GET /api/topics/:name/evolution`

Topic timeline grouped by publication year with optional top papers per year.

Params:

- `:name` (required): topic name fragment.
- `top_per_year` (optional): default `5`, max `10`.

Example:

```bash
curl "http://127.0.0.1:8787/api/topics/transformer/evolution?top_per_year=5"
```

### `GET /api/topics/:name/papers`

Topic papers list sorted by rank signal.

Params:

- `:name` (required): topic name fragment.
- `limit` (optional): default `20`, max `100`.

Example:

```bash
curl "http://127.0.0.1:8787/api/topics/transformer/papers?limit=25"
```

### `GET /api/recommend`

Simple hybrid recommendation endpoint:

- seed set from `user_library`
- semantic branch via `paper_vectors` centroid + topK
- graph branch via `cite_edges` 1-hop neighbors
- weighted RRF merge with reason labels (`semantic_similar`, `graph_neighbor`)

Params:

- `user_id` query or `x-user-id` header (required).
- `limit` (optional): default `20`, max `50`.
- `seed_limit` (optional): default `20`, max `40`.
- `candidate_limit` (optional): default `100`, max `150`.

Example:

```bash
curl "http://127.0.0.1:8787/api/recommend?user_id=user_123&limit=20"
```

### `GET /api/user/interests`

Returns topic interests for current user ordered by weight.

Auth:

- `x-user-id` header (or `user_id` query fallback)

Params:

- `limit` (optional): default `50`, max `200`.

### `PUT /api/user/interests`

Replaces user interests in one call.

Auth:

- `x-user-id` header (or `user_id` query fallback)

Payload:

- `topics[]` required
  - string form: `"transformers"` (weight defaults to `1`)
  - object form: `{ "topic": "transformers", "weight": 2.5 }`

### `GET /api/feed`

Reads generated feed items for current user.

Auth:

- `x-user-id` header (or `user_id` query fallback)

Params:

- `limit` (optional): default `20`, max `100`.
- `unread=true` (optional): only unseen entries.

### `PATCH /api/feed/:id/seen`

Marks one feed item as seen for the owner user.

Auth:

- `x-user-id` header (or `user_id` query fallback)

### `POST /api/cite/edges/:id/report`

Creates a user flag for potentially incorrect edge and increments `cite_edges.flagged_count`.

Auth:

- `x-user-id` header (or `user_id` query fallback)

Payload (optional):

- `flagCode` / `flag_code` (default: `wrong_citation`)
- `reasonCode` / `reason_code`

### `POST /api/annotations`

Create private highlight/note for current user.

Auth:

- `x-user-id` header (or `user_id` query fallback)

Payload:

- `doi` (required)
- `page` (required, positive number)
- `normRect` or flattened `norm_x`, `norm_y`, `norm_w`, `norm_h` (required, normalized)
- `color` (optional, default `yellow`)
- `note` (optional)

Example:

```bash
curl -X POST "http://127.0.0.1:8787/api/annotations" \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{
    "doi": "10.48550/arXiv.1706.03762",
    "page": 3,
    "normRect": { "x": 0.12, "y": 0.33, "width": 0.24, "height": 0.06 },
    "color": "yellow",
    "note": "Important transformer definition"
  }'
```

### `GET /api/annotations`

List user annotations for a DOI, optionally page-scoped.

Params:

- `doi` (required)
- `page` (optional)

Example:

```bash
curl "http://127.0.0.1:8787/api/annotations?doi=10.48550/arXiv.1706.03762&page=3" \
  -H "x-user-id: user_123"
```

### `PATCH /api/annotations/:id`

Update annotation fields for owner user.

Payload supports partial fields:

- `page`
- `normRect` or `norm_x`, `norm_y`, `norm_w`, `norm_h`
- `color`
- `note` (set `null`/empty to clear)

Example:

```bash
curl -X PATCH "http://127.0.0.1:8787/api/annotations/ann_xxx" \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{ "note": "Updated note", "color": "blue" }'
```

### `DELETE /api/annotations/:id`

Delete annotation by id (owner only).

```bash
curl -X DELETE "http://127.0.0.1:8787/api/annotations/ann_xxx" \
  -H "x-user-id: user_123"
```

### `POST /api/sessions/update`

Debounced-style idempotent session upsert by user + paper.

Auth:

- `x-user-id` header (or `user_id` query fallback)

Payload:

- `doi` (required)
- `last_page` (required, positive)
- `scroll_y` (optional, normalized 0..1)
- `delta_seconds` (optional, added into total reading time)

Example:

```bash
curl -X POST "http://127.0.0.1:8787/api/sessions/update" \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{
    "doi": "10.48550/arXiv.1706.03762",
    "last_page": 7,
    "scroll_y": 0.42,
    "delta_seconds": 5
  }'
```

### `GET /api/sessions/latest`

Get latest reading sessions for current user.

Params:

- `limit` (optional): default `5`, max `20`.

Example:

```bash
curl "http://127.0.0.1:8787/api/sessions/latest?limit=5" \
  -H "x-user-id: user_123"
```

### `DELETE /api/user/me`

Delete current user scoped records (GDPR style).

Cascade scope:

- `annotations`
- `user_library`
- `reading_sessions`
- `user_collections` + `collection_papers`
- `saved_searches`
- `notifications`
- `feed_items`
- `user_interests`

Example:

```bash
curl -X DELETE "http://127.0.0.1:8787/api/user/me" \
  -H "x-user-id: user_123"
```

### `POST /api/saved-searches`

Create saved search record for current user.

Payload:

- `name` (optional)
- `query` (required; string or object)
- `filters` (optional object)

Example:

```bash
curl -X POST "http://127.0.0.1:8787/api/saved-searches" \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{
    "name": "Recent transformers",
    "query": "transformer",
    "filters": { "year_from": 2020, "topic": "attention" }
  }'
```

### `GET /api/saved-searches`

List user saved searches.

Params:

- `limit` (optional): default `20`, max `100`.

Example:

```bash
curl "http://127.0.0.1:8787/api/saved-searches?limit=20" \
  -H "x-user-id: user_123"
```

### `DELETE /api/saved-searches/:id`

Delete saved search by id (owner only).

```bash
curl -X DELETE "http://127.0.0.1:8787/api/saved-searches/ss_xxx" \
  -H "x-user-id: user_123"
```

### `GET /api/notifications`

List user notifications.

Params:

- `unread=true` (optional)
- `limit` (optional): default `20`, max `100`.

Example:

```bash
curl "http://127.0.0.1:8787/api/notifications?unread=true&limit=20" \
  -H "x-user-id: user_123"
```

### `PATCH /api/notifications/:id/read`

Mark notification as read.

```bash
curl -X PATCH "http://127.0.0.1:8787/api/notifications/notif_xxx/read" \
  -H "x-user-id: user_123"
```

### `GET /api/pdf/proxy`

PDF proxy with allowlist validation, DOI/url normalization, user-agent rotation, in-memory rate-limit fallback, and cache headers.

Query params:

- `url` (optional): direct HTTPS PDF URL from allowlist hosts.
- `doi` (optional): DOI value (for DOI resolver flow).
- Either `url` or `doi` is required.

Behavior:

- Host allowlist enforced (`doi.org`, `arxiv.org`, `springer.com`, `nature.com`, etc.).
- DOI host/path and arXiv URL forms are normalized before fetch.
- In-memory per-target limiter: `6` requests/minute.
- Upstream `429/403` returns `429` with `retry_after`.
- Response cache control: `s-maxage=3600` + stale directives.

Examples:

```bash
curl -L "http://127.0.0.1:8787/api/pdf/proxy?doi=10.48550/arXiv.1706.03762"
curl -L "http://127.0.0.1:8787/api/pdf/proxy?url=https://arxiv.org/abs/1706.03762"
```

### Collections Endpoints (`x-user-id` required)

CRUD + collection-paper attach/detach routes:

- `POST /api/collections`
- `GET /api/collections`
- `PATCH /api/collections/:id`
- `DELETE /api/collections/:id`
- `POST /api/collections/:id/papers`
- `DELETE /api/collections/:id/papers/:doi`

Create example:

```bash
curl -X POST "http://127.0.0.1:8787/api/collections" \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{ "name": "Transformers", "description": "Thesis reading set" }'
```

Attach paper example:

```bash
curl -X POST "http://127.0.0.1:8787/api/collections/col_123/papers" \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{ "doi": "10.48550/arXiv.1706.03762" }'
```

### `GET /api/export/library`

User-scoped bibliography export. Requires `x-user-id` header (or `user_id` query fallback).

Params:

- `format` (required): `bibtex`, `ris`, or `json`.

The response is streamed/chunked and returned as downloadable attachment.

Examples:

```bash
curl -L "http://127.0.0.1:8787/api/export/library?format=bibtex" \
  -H "x-user-id: user_123"
curl -L "http://127.0.0.1:8787/api/export/library?format=ris" \
  -H "x-user-id: user_123"
```

### `GET /api/export/cite-subgraph`

One-hop cite neighborhood export around a node id.

Params:

- `id` (required): source node id.
- `format` (required): `bibtex`, `ris`, or `json`.

Response is streamed/chunked attachment.

Example:

```bash
curl -L "http://127.0.0.1:8787/api/export/cite-subgraph?id=node_123&format=json"
```

### `GET /api/resolve`

Identifier resolver for DOI/arXiv/URL.

Params:

- `id` (required): supports:
  - `doi:10.xxxx/...`
  - `arxiv:2401.12345`
  - DOI/arXiv URLs

Behavior:

- Looks up `paper_search` first, then `cite_nodes` / `doi_aliases`.
- If paper is found, returns canonical DOI redirect payload (`/paper/<doi>`) plus optional `tldr`.
- If not found, returns `202` pending ingest payload and queues a best-effort pending item.

Examples:

```bash
curl "http://127.0.0.1:8787/api/resolve?id=doi:10.48550/arXiv.1706.03762"
curl "http://127.0.0.1:8787/api/resolve?id=arxiv:1706.03762"
```

### `POST /api/papers/upload`

User PDF upload for personal ingest queue.

Auth:

- `x-user-id` header (or `user_id` query fallback)

Payload:

- `multipart/form-data` with `file` (preferred), or
- JSON `{ "filename": "paper.pdf", "content_base64": "..." }`

Limits:

- Max `50 MB` per upload
- Transient retention metadata `24h` (`expires_at`)

Storage:

- If `UPLOADS_BUCKET` R2 binding is configured, bytes are stored at `paper-uploads/{user_id}/{upload_id}.pdf`.
- Otherwise metadata is written to D1 (`paper_uploads` + `ingest_log`) and Colab must fetch by hash/DOI later.

Response (`202`):

- `upload_id`, `status`, `poll.href` for `/api/papers/upload-status/:id`

### `GET /api/papers/upload-status/:id`

Poll upload queue metadata for the current user.

### `POST /api/library/import`

Parse BibTeX/RIS content, extract DOIs, upsert `user_library`, queue unknown DOIs in `pending_bibs`.

Auth:

- `x-user-id` header required

Payload:

- JSON `{ "format": "bibtex|ris|auto", "content": "..." }`, or
- `multipart/form-data` with optional `file` + `format`

Limits:

- Max `2 MB` text content

Example:

```bash
curl -X POST "http://127.0.0.1:8787/api/library/import" \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{ "format": "bibtex", "content": "@article{demo, doi={10.48550/arXiv.1706.03762}, title={Demo}}"}'
```

### `POST /api/paper/bulk-upsert` (TLDR field)

OpenAlex sync papers may include optional `tldr` (Semantic Scholar summary via OpenAlex). The field is stored on `paper_search.tldr` and returned by search/public paper endpoints when present.

### Public Read-Only Routes

No user header required:

- `GET /api/public/paper/:doi`
- `GET /api/public/cite/:id`
- `GET /api/public/timeline/:id`
- `GET /api/public/search?q=...`

Examples:

```bash
curl "http://127.0.0.1:8787/api/public/paper/10.48550%2FarXiv.1706.03762"
curl "http://127.0.0.1:8787/api/public/cite/edge_123"
curl "http://127.0.0.1:8787/api/public/timeline/node_123?limit=25"
curl "http://127.0.0.1:8787/api/public/search?q=transformer&limit=20"
```

## Colab Pipeline Integration

### `POST /api/cite/bulk-ingest` — `meta.pending_bibs`

Colab pass7 may include unresolved bibliography targets in payload meta:

```json
{
  "meta": {
    "pending_bibs": [
      {
        "source_doi": "10.1000/a",
        "target_doi": "10.1000/b",
        "ref_index": 3,
        "bib_text": "Vaswani et al., 2017"
      }
    ]
  }
}
```

The Worker persists each entry into `pending_bibs` with `payload_json.kind = "cite_resolve"` and `user_id = "colab"`. Colab can poll these via `GET /api/internal/ingest-queue`.

### `GET /api/internal/ingest-queue`

Colab batch runner (`ingest_pipeline_runner.py --poll-queue`) polls queued PDF uploads and `pending_bibs` rows (`status = queued`). Each pending bib exposes parsed `payload` (including `target_doi` for `cite_resolve` rows).

Example:

```bash
curl "https://YOUR-WORKER/api/internal/ingest-queue?limit=25" \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN"
```

### `GET /api/internal/incoming-citations`

Pass8 cross-paper resolve queries active edges from source sentences to **reference placeholder** nodes on a target DOI:

```bash
curl "https://YOUR-WORKER/api/internal/incoming-citations?target_doi=10.1000/b&limit=200" \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN"
```

Returns `items[]` with `edge_id`, `source_id`, `source_doi`, `source_text`, `old_target_id`, `target_doi`, `ref_index`.

### `edge_supersedes` on bulk-ingest

When pass8 resolves cross-paper citations, Colab sends `edge_supersedes[]` alongside new edges. Each entry updates the old placeholder edge:

```json
{
  "edge_supersedes": [
    {
      "id": "old-edge-id",
      "status": "superseded",
      "algorithm_version": "v0-skeleton",
      "confidence_tier": "medium",
      "last_validated_at": 1710000000
    }
  ]
}
```

Applied via `applyEdgeRevalidationUpdates()` after node/edge upsert.

### `POST /api/internal/pending-bibs/complete`

After successful ingest, Colab marks queue rows consumed:

```bash
curl -X POST "https://YOUR-WORKER/api/internal/pending-bibs/complete" \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"target_dois":["10.1000/b"],"ids":["pending_abc123"]}'
```

## Notes

- Bulk ingest uses chunked multi-row insert/upsert to stay under D1's 100-parameter limit.
- Bulk ingest policy is hard-enforced at runtime:
  - default `50` papers/chunk (`BULK_INGEST_MAX_PAPERS_PER_CHUNK`)
  - default request body max `90 MB` (`BULK_INGEST_MAX_BODY_BYTES`)
  - content-length + parsed payload byte guards both apply
- On ingest failure, a minimal DLQ record is written to `ingest_dlq` with payload hash, size, and stage (`vector_upsert` or `d1_batch`) for replay.
- Ingest write order is strict: Vectorize upsert first, D1 upsert second.
- Revalidation cron is wired via Wrangler `[triggers].crons`; scheduled runs page deterministically by edge id and update `algorithm_version`, `confidence_tier`, `status`, and `last_validated_at`.
- Search and timeline apply defensive query parsing with validated defaults.
- Request middleware emits `x-trace-id` and `x-request-duration-ms` response headers.
- Observability helpers are centralized in `apps/api/src/observability.ts` for trace-id normalization and metric field generation.
- Production observability setup (Logpush, Analytics Engine, SLOs): `docs/observability-stack.md`.
- Internal metrics rollup: `GET /api/internal/metrics/summary?top_paths=20` (Bearer `INTERNAL_API_TOKEN` or `COLAB_INGEST_TOKEN`).
