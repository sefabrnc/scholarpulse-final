"""Drive-friendly SQLite checkpoint for batch Colab/Kaggle ingest."""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


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
