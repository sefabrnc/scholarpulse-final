ALTER TABLE cite_edges ADD COLUMN flagged_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_flags_user_edge
  ON edge_flags(user_id, edge_id);

CREATE INDEX IF NOT EXISTS idx_feed_items_user_score_event
  ON feed_items(user_id, score DESC, event_ts DESC);
