"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../../lib/api/client";

type InterestResponse = {
  topics: string[];
};

type FeedItem = {
  doi: string;
  score: number;
  reason: string;
  title?: string;
};

type SavedSearchRow = {
  id: string;
  name: string;
  query: string;
  filters?: Record<string, unknown> | null;
  last_run_at?: number | null;
};

export default function WatchPage() {
  const [topics, setTopics] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [feedPreview, setFeedPreview] = useState<FeedItem[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearchRow[]>([]);
  const [searchName, setSearchName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const loadFeedPreview = async () => {
    const response = await apiGet<{ items: FeedItem[] }>("/api/feed");
    setFeedPreview((response.items ?? []).slice(0, 5));
  };

  const loadSavedSearches = async () => {
    const response = await apiGet<{ items?: SavedSearchRow[] }>("/api/saved-searches");
    setSavedSearches(response.items ?? []);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await apiGet<InterestResponse>("/api/user/interests");
        if (alive) {
          setTopics(response.topics ?? []);
          setDraft((response.topics ?? []).join(", "));
        }
        await loadFeedPreview();
        await loadSavedSearches();
      } catch (cause) {
        if (alive) {
          setError(cause instanceof Error ? cause.message : "Interest request failed");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const nextTopics = draft
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    try {
      await apiPost("/api/user/interests", { topics: nextTopics });
      setTopics(nextTopics);
      setSavedAt(new Date().toLocaleTimeString());
      await loadFeedPreview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Interest save failed");
    }
  };

  const handleCreateSavedSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const query = searchQuery.trim();
    if (query.length < 2) {
      setError("Saved search query must be at least 2 characters.");
      return;
    }
    try {
      await apiPost("/api/saved-searches", {
        name: searchName.trim() || "Saved search",
        query,
        filters: { notify_in_app: true }
      });
      setSearchName("");
      setSearchQuery("");
      await loadSavedSearches();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saved search create failed");
    }
  };

  const handleDeleteSavedSearch = async (id: string) => {
    try {
      await apiDelete(`/api/saved-searches?id=${encodeURIComponent(id)}`);
      await loadSavedSearches();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saved search delete failed");
    }
  };

  return (
    <main className="page-shell column">
      <header>
        <h1 style={{ margin: "0 0 6px" }}>Watch</h1>
        <p className="muted-small">
          Topic watchlist drives nightly feed generation via <code>/api/user/interests</code>.
        </p>
      </header>
      <section className="section-card column">
        <strong>Active research topics</strong>
        <form onSubmit={handleSave} className="column">
          <textarea
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="transformers, retrieval augmented generation, multimodal learning"
          />
          <button type="submit">Save watch topics</button>
        </form>
        <p className="muted-small">Current: {topics.length > 0 ? topics.join(", ") : "No topics selected yet."}</p>
        {savedAt ? <p className="muted-small">Saved at {savedAt}. Feed preview refreshed.</p> : null}
      </section>

      <section className="section-card column">
        <strong>Saved searches</strong>
        <p className="muted-small">Nightly Colab job writes in-app notifications when new matches appear.</p>
        <form onSubmit={handleCreateSavedSearch} className="column">
          <input
            value={searchName}
            onChange={(event) => setSearchName(event.target.value)}
            placeholder="Search name (optional)"
          />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Query text or JSON params"
          />
          <button type="submit">Save search alert</button>
        </form>
        {savedSearches.length === 0 ? <p className="muted-small">No saved searches yet.</p> : null}
        {savedSearches.map((row) => (
          <article key={row.id} className="section-card row" style={{ justifyContent: "space-between" }}>
            <div className="column">
              <strong>{row.name}</strong>
              <span className="muted-small">{row.query}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                handleDeleteSavedSearch(row.id).catch(() => {
                  // handleDeleteSavedSearch sets error state
                });
              }}
            >
              Remove
            </button>
          </article>
        ))}
      </section>

      <section className="section-card column">
        <strong>Feed preview</strong>
        {feedPreview.length === 0 ? <p className="muted-small">No feed items yet for current topics.</p> : null}
        {feedPreview.map((item) => (
          <article key={`${item.doi}-${item.reason}`} className="section-card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{item.title ?? item.doi}</strong>
              <span className="muted-small">{item.score.toFixed(2)}</span>
            </div>
            <p className="muted-small">{item.reason}</p>
          </article>
        ))}
        <Link href="/feed" className="public-link">
          Open full feed
        </Link>
      </section>

      {error ? <p className="muted-small">Error: {error}</p> : null}
    </main>
  );
}
