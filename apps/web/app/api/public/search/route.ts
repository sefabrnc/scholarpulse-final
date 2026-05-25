import { NextResponse } from "next/server";
import { fetchOpenAlexJson, mapWork, type OpenAlexWork } from "../../../../lib/public/openalex";
import { fetchWorkerResponse, isWorkerConfigured, withFallbackSource } from "../../_lib/publicUpstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpenAlexSearchResponse = { results?: OpenAlexWork[] };

function parseYear(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMinCitations(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildFilterQuery(searchParams: URLSearchParams): string {
  const filters: string[] = [];
  const yearFrom = parseYear(searchParams.get("year_from"));
  const yearTo = parseYear(searchParams.get("year_to"));
  const minCitations = parseMinCitations(searchParams.get("min_citations"));
  const author = (searchParams.get("author") || "").trim();
  const topic = (searchParams.get("topic") || "").trim();
  const journal = (searchParams.get("journal") || "").trim();

  if (yearFrom !== null && yearTo !== null) {
    filters.push(`publication_year:${yearFrom}-${yearTo}`);
  } else if (yearFrom !== null) {
    filters.push(`publication_year:>${yearFrom - 1}`);
  } else if (yearTo !== null) {
    filters.push(`publication_year:<${yearTo + 1}`);
  }

  if (minCitations !== null) {
    filters.push(`cited_by_count:>${Math.max(0, minCitations - 1)}`);
  }
  if (author.length > 0) {
    filters.push(`authorships.author.display_name.search:${encodeURIComponent(author)}`);
  }
  if (topic.length > 0) {
    filters.push(`concepts.display_name.search:${encodeURIComponent(topic)}`);
  }
  if (journal.length > 0) {
    filters.push(`primary_location.source.display_name.search:${encodeURIComponent(journal)}`);
  }

  return filters.join(",");
}

function buildSortQuery(searchParams: URLSearchParams): string {
  const sort = (searchParams.get("sort") || "relevance").toLowerCase();
  if (sort === "citations") {
    return "cited_by_count:desc";
  }
  if (sort === "year") {
    return "publication_year:desc";
  }
  return "relevance_score:desc";
}

async function fetchOpenAlexSearch(searchParams: URLSearchParams, query: string) {
  const filter = buildFilterQuery(searchParams);
  const sort = buildSortQuery(searchParams);
  const params = new URLSearchParams({
    search: query,
    "per-page": "20",
    sort,
    select: "id,doi,title,publication_year,cited_by_count,primary_location,authorships"
  });
  if (filter.length > 0) {
    params.set("filter", filter);
  }

  const payload = await fetchOpenAlexJson<OpenAlexSearchResponse>(`/works?${params.toString()}`);
  return { results: (payload?.results ?? []).map(mapWork) };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();
  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const workerParams = new URLSearchParams(searchParams);
  workerParams.set("q", query);
  const workerResponse = await fetchWorkerResponse(`/api/public/search?${workerParams.toString()}`);
  if (workerResponse?.ok) {
    const payload = (await workerResponse.json()) as { items?: unknown[]; results?: unknown[] };
    const items = payload.items ?? payload.results ?? [];
    if (Array.isArray(items) && items.length > 0) {
      return NextResponse.json({ source: "worker", results: items });
    }
  }

  const openAlexPayload = await fetchOpenAlexSearch(searchParams, query);
  if (isWorkerConfigured()) {
    return NextResponse.json(withFallbackSource(openAlexPayload, "openalex_fallback"));
  }
  return NextResponse.json({ ...openAlexPayload, source: "openalex" });
}
