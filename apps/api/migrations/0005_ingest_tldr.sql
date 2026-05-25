-- TLDR summaries (OpenAlex / Semantic Scholar sync)
ALTER TABLE paper_search ADD COLUMN tldr TEXT;

-- Transient user PDF upload metadata (R2 binding optional; bytes live in R2 when configured)
CREATE TABLE IF NOT EXISTS paper_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filename TEXT,
  content_type TEXT,
  byte_size INTEGER NOT NULL,
  storage_backend TEXT NOT NULL DEFAULT 'd1_metadata',
  storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  expires_at INTEGER NOT NULL,
  metrics_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_paper_uploads_user_status ON paper_uploads(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_uploads_expires ON paper_uploads(expires_at);
