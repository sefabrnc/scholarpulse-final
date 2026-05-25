"""Drive-friendly SQLite checkpoint for batch Colab/Kaggle ingest."""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .cross_citations import IncomingCrossCitation, cross_citation_rows


@dataclass
class CheckpointCursor:
    run_id: str
    processed: int = 0
    last_doi: str = ""
    last_status: str = ""
    updated_at: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "processed": self.processed,
            "last_doi": self.last_doi,
            "last_status": self.last_status,
            "updated_at": self.updated_at,
        }


class CheckpointStore:
    """Minimal resume store: stage.sqlite + cursor.json mirror."""

    def __init__(self, checkpoint_dir: str, run_id: str = "default") -> None:
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        self.run_id = run_id
        self.db_path = self.checkpoint_dir / "stage.sqlite"
        self.cursor_path = self.checkpoint_dir / "cursor.json"
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS papers (
                    doi TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    error TEXT,
                    payload_path TEXT,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cross_citations (
                    edge_id TEXT PRIMARY KEY,
                    target_doi TEXT NOT NULL,
                    source_doi TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    source_text TEXT NOT NULL,
                    old_target_id TEXT NOT NULL,
                    ref_index INTEGER,
                    status TEXT NOT NULL DEFAULT 'pending',
                    updated_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_cross_citations_target_status
                    ON cross_citations(target_doi, status);
                CREATE TABLE IF NOT EXISTS pending_manifest (
                    doi TEXT PRIMARY KEY,
                    source TEXT NOT NULL DEFAULT 'expand_references',
                    updated_at REAL NOT NULL
                );
                """
            )
            conn.execute(
                "INSERT OR IGNORE INTO meta(key, value) VALUES('run_id', ?)",
                (self.run_id,),
            )

    def load_cursor(self) -> CheckpointCursor:
        if self.cursor_path.exists():
            data = json.loads(self.cursor_path.read_text(encoding="utf-8"))
            return CheckpointCursor(
                run_id=str(data.get("run_id", self.run_id)),
                processed=int(data.get("processed", 0)),
                last_doi=str(data.get("last_doi", "")),
                last_status=str(data.get("last_status", "")),
                updated_at=float(data.get("updated_at", 0.0)),
            )
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS c FROM papers WHERE status='ok'").fetchone()
            processed = int(row["c"]) if row else 0
        return CheckpointCursor(run_id=self.run_id, processed=processed)

    def save_cursor(self, cursor: CheckpointCursor) -> None:
        cursor.updated_at = time.time()
        self.cursor_path.write_text(
            json.dumps(cursor.to_dict(), indent=2, ensure_ascii=True),
            encoding="utf-8",
        )

    def is_done(self, doi: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT status FROM papers WHERE doi = ?",
                (doi,),
            ).fetchone()
        return bool(row and row["status"] == "ok")

    def record(
        self,
        doi: str,
        status: str,
        *,
        error: str = "",
        payload_path: str = "",
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO papers(doi, status, error, payload_path, updated_at)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(doi) DO UPDATE SET
                    status=excluded.status,
                    error=excluded.error,
                    payload_path=excluded.payload_path,
                    updated_at=excluded.updated_at
                """,
                (doi, status, error, payload_path, time.time()),
            )

    def iter_pending(self, manifest: Iterable[Dict[str, Any]]) -> Iterable[Dict[str, Any]]:
        for item in manifest:
            doi = str(item.get("doi", "")).strip()
            if not doi:
                continue
            if self.is_done(doi):
                continue
            yield item

    def record_cross_citations(self, items: Iterable[IncomingCrossCitation]) -> int:
        rows = cross_citation_rows(items)
        if not rows:
            return 0
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO cross_citations(
                    edge_id, target_doi, source_doi, source_id, source_text,
                    old_target_id, ref_index, status, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(edge_id) DO UPDATE SET
                    target_doi=excluded.target_doi,
                    source_doi=excluded.source_doi,
                    source_id=excluded.source_id,
                    source_text=excluded.source_text,
                    old_target_id=excluded.old_target_id,
                    ref_index=excluded.ref_index,
                    status=excluded.status,
                    updated_at=excluded.updated_at
                """,
                rows,
            )
        return len(rows)

    def load_cross_citations_for_target(self, target_doi: str) -> List[IncomingCrossCitation]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT edge_id, target_doi, source_doi, source_id, source_text,
                       old_target_id, ref_index
                FROM cross_citations
                WHERE target_doi = ? AND status = 'pending'
                ORDER BY updated_at ASC
                """,
                (target_doi,),
            ).fetchall()
        found: List[IncomingCrossCitation] = []
        for row in rows:
            mapped = IncomingCrossCitation.from_mapping(
                {
                    "edge_id": row["edge_id"],
                    "target_doi": row["target_doi"],
                    "source_doi": row["source_doi"],
                    "source_id": row["source_id"],
                    "source_text": row["source_text"],
                    "old_target_id": row["old_target_id"],
                    "ref_index": row["ref_index"],
                }
            )
            if mapped:
                found.append(mapped)
        return found

    def mark_cross_citations_resolved(self, edge_ids: Iterable[str]) -> int:
        ids = [edge_id for edge_id in edge_ids if edge_id]
        if not ids:
            return 0
        now = time.time()
        with self._connect() as conn:
            conn.executemany(
                """
                UPDATE cross_citations
                SET status = 'resolved', updated_at = ?
                WHERE edge_id = ?
                """,
                [(now, edge_id) for edge_id in ids],
            )
        return len(ids)

    def record_pending_manifest(self, dois: Iterable[str], *, source: str = "expand_references") -> int:
        rows = [(str(doi).strip(), source, time.time()) for doi in dois if str(doi).strip()]
        if not rows:
            return 0
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO pending_manifest(doi, source, updated_at)
                VALUES(?, ?, ?)
                ON CONFLICT(doi) DO UPDATE SET
                    source=excluded.source,
                    updated_at=excluded.updated_at
                """,
                rows,
            )
        return len(rows)

    def load_pending_manifest(self) -> List[str]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT doi
                FROM pending_manifest
                ORDER BY updated_at ASC
                """
            ).fetchall()
        return [str(row["doi"]) for row in rows if row["doi"]]

    def clear_pending_manifest(self, dois: Iterable[str]) -> int:
        ids = [str(doi).strip() for doi in dois if str(doi).strip()]
        if not ids:
            return 0
        with self._connect() as conn:
            conn.executemany("DELETE FROM pending_manifest WHERE doi = ?", [(doi,) for doi in ids])
        return len(ids)
