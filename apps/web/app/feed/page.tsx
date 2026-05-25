"use client";

import { useEffect, useMemo, useState } from "react";
import { PaperCard } from "../../components/paper/PaperCard";
import { apiGet } from "../../lib/api/client";
import { usePaperBadges } from "../../hooks/usePaperBadges";

type FeedItem = {
  doi: string;
  score: number;
  reason: string;
  created_at?: string;
  title?: string;
  publicationYear?: number | null;
  venue?: string | null;
  reasons?: string[];
  semanticRank?: number | null;
  graphRank?: number | null;
};

type FeedResponse = {
  items: FeedItem[];
};

type InterestsResponse = {
  topics: string[];
};

type RecommendResponse = {
  items: FeedItem[];
  seeds?: string[];
};

function reasonLabel(reason: string): string {
  if (reason === "semantic_similar") {
    return "Semantic match";
  }
  if (reason === "graph_neighbor") {
    return "Citation graph";
  }
  if (reason === "topic_match") {
    return "Topic match";
  }
  return reason.replace(/_/g, " ");
}

function reasonClass(reason: string): string {
  if (reason === "semantic_similar") {
    return "feed-reason feed-reason-semantic";
  }
  if (reason === "graph_neighbor") {
    return "feed-reason feed-reason-graph";
  }
  return "feed-reason";
}

export default function FeedPage() {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<FeedItem[]>([]);
  const [recommendSeeds, setRecommendSeeds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [feed, interests, recommend] = await Promise.all([
          apiGet<FeedResponse>("/api/feed"),
          apiGet<InterestsResponse>("/api/user/interests"),
          apiGet<RecommendResponse>("/api/recommend?limit=24&candidate_limit=50")
        ]);
        if (!alive) {
          return;
        }
        setFeedItems(feed.items ?? []);
        setTopics(interests.topics ?? []);
        setRecommendations(recommend.items ?? []);
        setRecommendSeeds(recommend.seeds ?? []);
      } catch (cause) {
        if (!alive) {
          return;
        }
        setError(cause instanceof Error ? cause.message : "Feed request failed");
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const semanticRecommendations = useMemo(
    () => recommendations.filter((item) => item.reason === "semantic_similar"),
    [recommendations]
  );
  const graphRecommendations = useMemo(
    () => recommendations.filter((item) => item.reason === "graph_neighbor"),
    [recommendations]
  );
  const hybridRecommendations = useMemo(
    () =>
      recommendations.filter(
        (item) => (item.reasons?.length ?? 0) > 1 || (item.semanticRank && item.graphRank)
      ),
    [recommendations]
  );

  const badgeDois = useMemo(() => {
    const combined = [...feedItems, ...recommendations];
    return combined.map((item) => item.doi);
  }, [feedItems, recommendations]);
  const { byDoi: badgesByDoi } = usePaperBadges(badgeDois);

  const recommendStats = useMemo(() => {
    const hybrid = recommendations.filter(
      (item) => (item.reasons?.length ?? 0) > 1 || (item.semanticRank && item.graphRank)
    ).length;
    return {
      total: recommendations.length,
      semantic: semanticRecommendations.length,
      graph: graphRecommendations.length,
      hybrid
    };
  }, [recommendations, semanticRecommendations.length, graphRecommendations.length]);

  return (
    <main className="page-shell column">
      <header>
        <h1 style={{ margin: "0 0 6px" }}>Feed</h1>
        <p className="muted-small">
          Nightly feed plus hybrid recommend (Vectorize centroid + citation-graph RRF).
        </p>
      </header>

      <section className="section-card column">
        <strong>Interest topics</strong>
        <p className="muted-small">{topics.length > 0 ? topics.join(", ") : "No interest topics yet."}</p>
      </section>

      <section className="section-card column">
        <strong>Feed items</strong>
        {loading ? <p className="muted-small">Loading feed...</p> : null}
        {error ? <p className="muted-small">Error: {error}</p> : null}
        {!loading && !error && feedItems.length === 0 ? <p className="muted-small">No feed items available.</p> : null}
        {feedItems.map((item) => (
          <PaperCard
            key={`feed-${item.doi}-${item.reason}`}
            doi={item.doi}
            title={item.title ?? item.doi}
            subtitle={`${reasonLabel(item.reason)}${item.created_at ? ` · ${new Date(item.created_at).toLocaleDateString()}` : ""}`}
            meta={`score ${item.score.toFixed(2)}`}
            showBadge
            badge={badgesByDoi[item.doi] ?? null}
          />
        ))}
      </section>

      <section className="section-card column">
        <div className="feed-recommend-header">
          <strong>Smart recommendations</strong>
          {!loading && recommendStats.total > 0 ? (
            <span className="feed-recommend-stats muted-small">
              {recommendStats.total} papers · {recommendStats.semantic} semantic · {recommendStats.graph} graph
              {recommendStats.hybrid > 0 ? ` · ${recommendStats.hybrid} hybrid` : ""}
            </span>
          ) : null}
        </div>
        {!loading && recommendSeeds.length > 0 ? (
          <p className="muted-small">
            Seeded from {recommendSeeds.length} saved library paper
            {recommendSeeds.length === 1 ? "" : "s"}
            {recommendSeeds.length <= 3 ? `: ${recommendSeeds.join(", ")}` : ""}.
          </p>
        ) : null}
        {!loading && recommendations.length === 0 ? (
          <div className="feed-recommend-empty column">
            <p className="muted-small">
              No recommendations yet. Save papers to your library to seed semantic + graph suggestions.
            </p>
            <p className="muted-small">
              Tip: open a paper from Search or Desk, then add it to your library. Recommendations refresh on
              the next visit.
            </p>
          </div>
        ) : null}

        {semanticRecommendations.length > 0 ? (
          <div className="column">
            <span className="feed-section-label">Semantic matches</span>
            {semanticRecommendations.map((item) => (
              <article key={`rec-semantic-${item.doi}`} className="feed-recommend-row">
                <span className={reasonClass(item.reason)}>{reasonLabel(item.reason)}</span>
                <PaperCard
                  doi={item.doi}
                  title={item.title ?? item.doi}
                  subtitle={
                    item.venue
                      ? `${item.publicationYear ?? "?"} · ${item.venue}`
                      : item.publicationYear
                        ? `${item.publicationYear}`
                        : undefined
                  }
                  meta={`score ${item.score.toFixed(4)}${item.semanticRank ? ` · rank #${item.semanticRank}` : ""}`}
                  showBadge
                  badge={badgesByDoi[item.doi] ?? null}
                />
              </article>
            ))}
          </div>
        ) : null}

        {graphRecommendations.length > 0 ? (
          <div className="column">
            <span className="feed-section-label">Citation graph neighbors</span>
            {graphRecommendations.map((item) => (
              <article key={`rec-graph-${item.doi}`} className="feed-recommend-row">
                <span className={reasonClass(item.reason)}>{reasonLabel(item.reason)}</span>
                <PaperCard
                  doi={item.doi}
                  title={item.title ?? item.doi}
                  subtitle={
                    item.venue
                      ? `${item.publicationYear ?? "?"} · ${item.venue}`
                      : item.publicationYear
                        ? `${item.publicationYear}`
                        : undefined
                  }
                  meta={`score ${item.score.toFixed(4)}${item.graphRank ? ` · rank #${item.graphRank}` : ""}`}
                  showBadge
                  badge={badgesByDoi[item.doi] ?? null}
                />
              </article>
            ))}
          </div>
        ) : null}

        {hybridRecommendations.length > 0 ? (
          <div className="column">
            <span className="feed-section-label">Hybrid matches (semantic + graph)</span>
            {hybridRecommendations.map((item) => (
              <article key={`rec-hybrid-${item.doi}`} className="feed-recommend-row">
                <span className="feed-reason feed-reason-hybrid">Hybrid</span>
                <PaperCard
                  doi={item.doi}
                  title={item.title ?? item.doi}
                  subtitle={
                    item.venue
                      ? `${item.publicationYear ?? "?"} · ${item.venue}`
                      : item.publicationYear
                        ? `${item.publicationYear}`
                        : undefined
                  }
                  meta={`score ${item.score.toFixed(4)} · semantic #${item.semanticRank ?? "?"} · graph #${item.graphRank ?? "?"}`}
                  showBadge
                  badge={badgesByDoi[item.doi] ?? null}
                />
              </article>
            ))}
          </div>
        ) : null}

        {!loading &&
        semanticRecommendations.length === 0 &&
        graphRecommendations.length === 0 &&
        recommendations.length > 0
          ? recommendations.map((item) => (
              <PaperCard
                key={`rec-${item.doi}-${item.reason}`}
                doi={item.doi}
                title={item.title ?? item.doi}
                subtitle={reasonLabel(item.reason)}
                meta={`score ${item.score.toFixed(2)}`}
                showBadge
                badge={badgesByDoi[item.doi] ?? null}
              />
            ))
          : null}
      </section>
    </main>
  );
}
