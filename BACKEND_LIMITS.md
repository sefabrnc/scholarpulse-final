# Backend Limits (Initial Ops Notes)

This note captures hard limits used by `apps/api` ingest flows.

## Cloudflare Worker Runtime

- Request body practical target for bulk ingest: `<= 90 MB` (keep margin below platform max body size).
- CPU budget target per request: stay under `30s` by chunking and batching.
- Use fail-fast behavior for critical pre-write steps (for example Vectorize upsert before D1 writes).

## Cloudflare D1

- Max bound parameters per SQL statement: `100`.
- Current ingest batching uses this rule through `MAX_SQL_PARAMS = 100`.
- Multi-row insert chunking must always satisfy: `rows_per_statement * columns_per_row <= 100`.

## Ingest Chunk Strategy

- Chunk by paper groups with hard enforcement (default: `50 papers/chunk`).
- Policy knobs:
  - `BULK_INGEST_MAX_PAPERS_PER_CHUNK` (default `50`)
  - `BULK_INGEST_MAX_BODY_BYTES` (default `94,371,840` bytes = `90 MB`)
- Within a chunk:
  1. Upsert vectors (`sentence_vectors`, `paper_vectors`) first.
  2. If vector upsert succeeds, run D1 batch UPSERTs.
  3. If any vector upsert fails, abort request (fail-fast, no D1 write).
- Keep UPSERT idempotency (`ON CONFLICT DO UPDATE`) for retry-safe ingestion.
- Body guards enforce both `content-length` and parsed payload byte size.

## Operational Follow-ups

- Add periodic D1 backup automation.
- Add ingest latency/error monitoring and alerting.

## Ops Runbook (Chunking, Retry, Reconciliation, DLQ)

1. Chunking:
   - Keep ingest payloads around `50 papers/chunk` and `< 90 MB` request body.
   - Respect D1 parameter ceiling with `rows * columns <= 100` per SQL statement.
   - Keep Vectorize upsert first, then D1 UPSERT sequence.

2. Retry:
   - Use `/api/internal/pending-bibs/retry` to re-queue due or explicit `pending_bibs` records.
   - Every retry increments `retry_count`, marks item `retrying`, and schedules next attempt.
   - Use bounded retries at scheduler level (for example max `5` attempts) before DLQ.
   - For ingest failures, record fallback rows in `ingest_dlq` (stage, error_code, payload_hash, payload_bytes, paper_count).

3. Reconciliation:
   - Use `/api/internal/edges-to-revalidate` (cursor + limit + filters) for nightly edge review batches.
   - Write outcomes through `/api/internal/revalidate-edges` or `/api/internal/edges-update`.
   - Scheduled cron (`wrangler.toml` trigger) runs deterministic paging and updates `algorithm_version`, `confidence_tier`, `status`, and `last_validated_at`.
   - Use `/api/internal/ingest-log` for ingest drift checks (`failed`, `partial`, stale batches).

4. DLQ flow:
   - Move items that exceed retry policy to a DLQ queue/store (external queue or dedicated table).
   - Current minimal implementation uses D1 table `ingest_dlq`.
   - Preserve `trace_id`, source batch id, and last error payload for manual replay.
   - Replay from DLQ only after root-cause fix and keep replay idempotent.
