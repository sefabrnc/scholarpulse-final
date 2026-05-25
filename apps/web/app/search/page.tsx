"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { PaperCard } from "../../components/paper/PaperCard";
import {
  SearchFiltersPanel,
  buildSearchQueryParams,
  type SearchFilterValues
} from "../../components/search/SearchFiltersPanel";
import { EmptyState, LoadingState, PublicScaffold } from "../../components/public/PublicScaffold";
import { usePaperBadges } from "../../hooks/usePaperBadges";

type PublicSearchResult = {
  id: string;
  doi: string | null;
  title: string;
  year: number | null;
  citedByCount: number;
  url: string;
  authors: string[];
};

type HybridSearchItem = {
  nodeId: string;
  title: string;
  authorsText: string | null;
  venue: string | null;
  publicationYear: number | null;
  doiNorm: string | null;
  tldr: string | null;
  rankSignal: number;
  score: number;
  influentialCount?: number;
};

const DEFAULT_FILTERS: SearchFilterValues = {
  yearFrom: "",
  yearTo: "",
  minCitations: "",
  author: "",
  topic: "",
  journal: "",
  sort: "relevance"
};

export default function PublicSearchPage() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilterValues>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"hybrid" | "openalex">("hybrid");
  const [publicResults, setPublicResults] = useState<PublicSearchResult[]>([]);
  const [hybridResults, setHybridResults] = useState<HybridSearchItem[]>([]);
  const [error, setError] = useState("");

  const hybridDois = useMemo(
    () =>
      hybridResults
        .map((item) => item.doiNorm)
        .filter((doi): doi is string => Boolean(doi)),
    [hybridResults]
  );
  const { byDoi: badgesByDoi } = usePaperBadges(hybridDois);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setPublicResults([]);
      setHybridResults([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const hybridParams = buildSearchQueryParams(q, filters);
      const hybridResponse = await fetch(`/api/search?${hybridParams.toString()}`);
      if (hybridResponse.ok) {
        const payload = (await hybridResponse.json()) as { items?: HybridSearchItem[] };
        const items = payload.items ?? [];
        if (items.length > 0) {
          setHybridResults(items);
          setPublicResults([]);
          setMode("hybrid");
          return;
        }
      }

      const publicParams = new URLSearchParams({ q });
      if (filters.yearFrom.trim()) {
        publicParams.set("year_from", filters.yearFrom.trim());
      }
      if (filters.yearTo.trim()) {
        publicParams.set("year_to", filters.yearTo.trim());
      }
      if (filters.minCitations.trim()) {
        publicParams.set("min_citations", filters.minCitations.trim());
      }
      if (filters.author.trim()) {
        publicParams.set("author", filters.author.trim());
      }
      if (filters.topic.trim()) {
        publicParams.set("topic", filters.topic.trim());
      }
      if (filters.journal.trim()) {
        publicParams.set("journal", filters.journal.trim());
      }
      publicParams.set("sort", filters.sort);

      const publicResponse = await fetch(`/api/public/search?${publicParams.toString()}`);
      if (!publicResponse.ok) {
        throw new Error("Search request failed");
      }
      const publicPayload = (await publicResponse.json()) as { results?: PublicSearchResult[] };
      setPublicResults(publicPayload.results ?? []);
      setHybridResults([]);
      setMode("openalex");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to search right now");
      setPublicResults([]);
      setHybridResults([]);
    } finally {
      setLoading(false);
    }
  }

  const hasResults = hybridResults.length > 0 || publicResults.length > 0;

  return (
    <PublicScaffold
      title="Search"
      subtitle="Hybrid Worker search with filters and sort; falls back to OpenAlex when upstream is empty."
    >
      <form onSubmit={onSubmit} className="public-search-form column">
        <div className="row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by keyword, DOI, or title..."
            className="public-input"
          />
          <button type="submit" className="public-button">
            Search
          </button>
        </div>
        <SearchFiltersPanel values={filters} onChange={setFilters} disabled={loading} />
      </form>

      {loading ? <LoadingState /> : null}
      {error ? <p className="public-error">{error}</p> : null}
      {!loading && !error && !hasResults ? (
        <EmptyState message="Try a broader keyword to see papers." />
      ) : null}

      {mode === "hybrid" && hybridResults.length > 0 ? (
        <ul className="public-list">
          {hybridResults.map((result) => (
            <li key={result.nodeId} className="public-card">
              {result.doiNorm ? (
                <PaperCard
                  doi={result.doiNorm}
                  title={result.title}
                  subtitle={result.authorsText ?? "Unknown authors"}
                  meta={`${result.publicationYear ?? "Unknown year"} · score ${result.score.toFixed(3)}${
                    result.influentialCount ? ` · ${result.influentialCount} influential` : ""
                  }`}
                  showBadge
                  badge={badgesByDoi[result.doiNorm] ?? null}
                />
              ) : (
                <>
                  <h2 className="public-card-title">{result.title}</h2>
                  <p className="public-muted">{result.authorsText ?? "Unknown authors"}</p>
                </>
              )}
              {result.tldr ? <p className="public-muted">{result.tldr}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {mode === "openalex" && publicResults.length > 0 ? (
        <ul className="public-list">
          {publicResults.map((result) => (
            <li key={result.id} className="public-card">
              <h2 className="public-card-title">{result.title}</h2>
              <p className="public-muted">{result.authors.slice(0, 4).join(", ") || "Unknown authors"}</p>
              <p className="public-muted">
                {result.year ?? "Unknown year"} · {result.citedByCount} citations
              </p>
              <div className="public-links">
                {result.doi ? (
                  <Link href={`/paper/${encodeURIComponent(result.doi)}`} className="public-link">
                    Open public paper page
                  </Link>
                ) : null}
                {result.url ? (
                  <a href={result.url} target="_blank" rel="noreferrer" className="public-link-muted">
                    Source
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </PublicScaffold>
  );
}
