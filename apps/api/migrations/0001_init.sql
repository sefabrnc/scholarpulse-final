PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cite_nodes (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_ref TEXT,
  title TEXT NOT NULL,
  doi_norm TEXT,
  publication_year INTEGER,
  venue TEXT,
  node_type TEXT NOT NULL DEFAULT 'paper',
  metadata_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS cite_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  weight REAL,
  evidence_ref TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (from_node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (to_node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paper_search (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  authors_text TEXT,
  venue TEXT,
  topic_terms TEXT,
  publication_year INTEGER,
  doi_norm TEXT,
  rank_signal REAL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS paper_fts USING fts5(
  title,
  authors_text,
  venue,
  topic_terms,
  content = paper_search,
  content_rowid = id,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS paper_search_ai AFTER INSERT ON paper_search BEGIN
  INSERT INTO paper_fts(rowid, title, authors_text, venue, topic_terms)
  VALUES (new.id, new.title, new.authors_text, new.venue, new.topic_terms);
END;

CREATE TRIGGER IF NOT EXISTS paper_search_ad AFTER DELETE ON paper_search BEGIN
  INSERT INTO paper_fts(paper_fts, rowid, title, authors_text, venue, topic_terms)
  VALUES ('delete', old.id, old.title, old.authors_text, old.venue, old.topic_terms);
END;

CREATE TRIGGER IF NOT EXISTS paper_search_au AFTER UPDATE ON paper_search BEGIN
  INSERT INTO paper_fts(paper_fts, rowid, title, authors_text, venue, topic_terms)
  VALUES ('delete', old.id, old.title, old.authors_text, old.venue, old.topic_terms);
  INSERT INTO paper_fts(rowid, title, authors_text, venue, topic_terms)
  VALUES (new.id, new.title, new.authors_text, new.venue, new.topic_terms);
END;

CREATE TABLE IF NOT EXISTS paper_authors (
  node_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (node_id, author_id),
  FOREIGN KEY (node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paper_topics (
  node_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  score REAL,
  PRIMARY KEY (node_id, topic),
  FOREIGN KEY (node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS doi_aliases (
  doi_norm TEXT NOT NULL,
  doi_raw TEXT NOT NULL,
  node_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (doi_norm, doi_raw),
  FOREIGN KEY (node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_library (
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'saved',
  rating INTEGER,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_opened_at INTEGER,
  PRIMARY KEY (user_id, node_id),
  FOREIGN KEY (node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_interests (
  user_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, topic)
);

CREATE TABLE IF NOT EXISTS feed_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  score REAL,
  event_ts INTEGER NOT NULL,
  seen_at INTEGER,
  clicked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  page INTEGER,
  x REAL,
  y REAL,
  width REAL,
  height REAL,
  color TEXT,
  kind TEXT NOT NULL DEFAULT 'highlight',
  payload_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reading_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  dwell_ms INTEGER NOT NULL DEFAULT 0,
  last_page INTEGER,
  progress_ratio REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS collection_papers (
  collection_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (collection_id, node_id),
  FOREIGN KEY (collection_id) REFERENCES user_collections(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES cite_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  filters_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_run_at INTEGER
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  read_at INTEGER
);

CREATE TABLE IF NOT EXISTS edge_flags (
  id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  flag_code TEXT NOT NULL,
  reason_code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (edge_id) REFERENCES cite_edges(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ingest_log (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  batch_ref TEXT,
  error_code TEXT,
  metrics_json TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS pending_bibs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  payload_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_cite_nodes_doi_norm ON cite_nodes(doi_norm);
CREATE INDEX IF NOT EXISTS idx_cite_nodes_year ON cite_nodes(publication_year);
CREATE INDEX IF NOT EXISTS idx_cite_edges_from ON cite_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_cite_edges_to ON cite_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_cite_edges_type ON cite_edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_paper_search_year ON paper_search(publication_year);
CREATE INDEX IF NOT EXISTS idx_paper_search_rank ON paper_search(rank_signal DESC);
CREATE INDEX IF NOT EXISTS idx_paper_authors_name ON paper_authors(author_name);
CREATE INDEX IF NOT EXISTS idx_paper_topics_topic ON paper_topics(topic);
CREATE INDEX IF NOT EXISTS idx_doi_aliases_node ON doi_aliases(node_id);
CREATE INDEX IF NOT EXISTS idx_user_library_user_status ON user_library(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_interests_weight ON user_interests(user_id, weight DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_user_event ON feed_items(user_id, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_annotations_user_node ON annotations(user_id, node_id);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_started ON reading_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_papers_node ON collection_papers(node_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_flags_edge ON edge_flags(edge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_log_status ON ingest_log(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_bibs_user_status ON pending_bibs(user_id, status, next_retry_at);
