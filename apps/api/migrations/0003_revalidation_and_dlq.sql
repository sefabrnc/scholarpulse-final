CREATE INDEX IF NOT EXISTS idx_cite_edges_revalidation_cursor
  ON cite_edges(status, confidence_tier, last_validated_at, id);

CREATE TABLE IF NOT EXISTS ingest_dlq (
  id TEXT PRIMARY KEY,
  batch_ref TEXT,
  stage TEXT NOT NULL,
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  payload_hash TEXT,
  payload_bytes INTEGER,
  paper_count INTEGER,
  retryable INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ingest_dlq_status_created
  ON ingest_dlq(status, created_at DESC);
