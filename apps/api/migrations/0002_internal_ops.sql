ALTER TABLE cite_edges ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE cite_edges ADD COLUMN algorithm_version TEXT;
ALTER TABLE cite_edges ADD COLUMN confidence_tier TEXT;
ALTER TABLE cite_edges ADD COLUMN last_validated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_cite_edges_status_validated
  ON cite_edges(status, last_validated_at);
