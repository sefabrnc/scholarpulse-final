"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api/client";

type SessionItem = {
  id?: string;
  doi?: string | null;
  title?: string;
  last_page?: number | null;
  scroll_y?: number | null;
  progress_ratio?: number | null;
  total_seconds?: number;
  last_seen_at?: number | string;
};

type ContinueReadingProps = {
  limit?: number;
  compact?: boolean;
};

export function ContinueReading(props: ContinueReadingProps) {
  const limit = props.limit ?? 5;
  const [items, setItems] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiGet<{ items?: SessionItem[] }>(
          `/api/sessions/latest?limit=${encodeURIComponent(String(limit))}`
        );
        if (!alive) {
          return;
        }
        setItems(response.items ?? []);
      } catch (cause) {
        if (!alive) {
          return;
        }
        setError(cause instanceof Error ? cause.message : "Sessions request failed");
        setItems([]);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [limit]);

  if (loading) {
    return <p className="muted-small">Loading continue reading...</p>;
  }

  if (error) {
    return <p className="muted-small">Continue reading unavailable: {error}</p>;
  }

  if (items.length === 0) {
    return <p className="muted-small">No recent reading sessions yet.</p>;
  }

  return (
    <ul className={`continue-reading-list${props.compact ? " compact" : ""}`}>
      {items.map((item) => {
        const doi = item.doi?.trim();
        if (!doi) {
          return null;
        }
        const scrollY = item.scroll_y ?? item.progress_ratio;
        const progress =
          typeof scrollY === "number" && scrollY > 0
            ? `${Math.round(scrollY * 100)}%`
            : item.last_page
              ? `page ${item.last_page}`
              : "resume";
        return (
          <li key={item.id ?? doi} className="continue-reading-item">
            <div className="continue-reading-main">
              <strong>{item.title ?? doi}</strong>
              <span className="muted-small">{progress}</span>
            </div>
            <Link href={`/paper/${encodeURIComponent(doi)}`} className="continue-reading-link">
              Continue
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
