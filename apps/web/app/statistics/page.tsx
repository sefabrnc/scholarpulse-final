"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api/client";

type FeedItem = { score?: number; reason?: string };
type Collection = { count?: number };
type Annotation = { id: string };
type SessionItem = { doi?: string; total_seconds?: number; last_page?: number };

type StatsSnapshot = {
  feedCount: number;
  recommendCount: number;
  annotationCount: number;
  collectionCount: number;
  collectionPaperCount: number;
  averageFeedScore: number;
  readingSeconds: number;
  recentSessions: number;
  reasonCounts: Record<string, number>;
};

export default function StatisticsPage() {
  const [stats, setStats] = useState<StatsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setError(null);
      try {
        const [feed, recommend, collections, annotations, sessions] = await Promise.all([
          apiGet<{ items: FeedItem[] }>("/api/feed"),
          apiGet<{ items: FeedItem[] }>("/api/recommend"),
          apiGet<{ collections: Collection[] }>("/api/collections"),
          apiGet<{ items: Annotation[] }>("/api/annotations"),
          apiGet<{ items: SessionItem[] }>("/api/sessions/latest?limit=10")
        ]);
        if (!alive) {
          return;
        }

        const feedItems = feed.items ?? [];
        const recommendItems = recommend.items ?? [];
        const collectionRows = collections.collections ?? [];
        const sessionItems = sessions.items ?? [];
        const scoreTotal = feedItems.reduce((sum, item) => sum + (item.score ?? 0), 0);
        const reasonCounts: Record<string, number> = {};
        for (const item of [...feedItems, ...recommendItems]) {
          const reason = item.reason ?? "unknown";
          reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
        }

        setStats({
          feedCount: feedItems.length,
          recommendCount: recommendItems.length,
          annotationCount: (annotations.items ?? []).length,
          collectionCount: collectionRows.length,
          collectionPaperCount: collectionRows.reduce((sum, row) => sum + (row.count ?? 0), 0),
          averageFeedScore: feedItems.length > 0 ? scoreTotal / feedItems.length : 0,
          readingSeconds: sessionItems.reduce((sum, item) => sum + (item.total_seconds ?? 0), 0),
          recentSessions: sessionItems.length,
          reasonCounts
        });
      } catch (cause) {
        if (alive) {
          setError(cause instanceof Error ? cause.message : "Statistics request failed");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const cards = useMemo(
    () =>
      stats
        ? [
            { label: "Feed items", value: stats.feedCount.toString() },
            { label: "Recommendations", value: stats.recommendCount.toString() },
            { label: "Collections", value: stats.collectionCount.toString() },
            { label: "Collection papers", value: stats.collectionPaperCount.toString() },
            { label: "Annotations", value: stats.annotationCount.toString() },
            { label: "Recent sessions", value: stats.recentSessions.toString() },
            { label: "Reading time (sec)", value: stats.readingSeconds.toString() },
            { label: "Avg feed score", value: stats.averageFeedScore.toFixed(2) }
          ]
        : [],
    [stats]
  );

  const reasonRows = useMemo(
    () =>
      stats
        ? Object.entries(stats.reasonCounts).sort((a, b) => b[1] - a[1])
        : [],
    [stats]
  );

  return (
    <main className="page-shell column">
      <header>
        <h1 style={{ margin: "0 0 6px" }}>Statistics</h1>
        <p className="muted-small">
          Derived summary from feed, recommend, collections, annotations, and sessions endpoints.
        </p>
      </header>

      {error ? <p className="muted-small">Error: {error}</p> : null}
      <section className="section-card column">
        {!stats ? <p className="muted-small">Loading statistics...</p> : null}
        {cards.map((card) => (
          <article key={card.label} className="section-card row" style={{ justifyContent: "space-between" }}>
            <strong>{card.label}</strong>
            <span>{card.value}</span>
          </article>
        ))}
      </section>

      {reasonRows.length > 0 ? (
        <section className="section-card column">
          <strong>Reason breakdown</strong>
          {reasonRows.map(([reason, count]) => (
            <article key={reason} className="section-card row" style={{ justifyContent: "space-between" }}>
              <span>{reason}</span>
              <strong>{count}</strong>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
