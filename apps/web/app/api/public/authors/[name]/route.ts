import { NextResponse } from "next/server";
import { fetchOpenAlexJson, mapWork, type OpenAlexWork } from "../../../../../lib/public/openalex";
import {
  fetchWorkerJson,
  isWorkerConfigured,
  mapWorkerAuthorPayload,
  withFallbackSource,
  type WorkerAuthorResponse
} from "../../../_lib/publicUpstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpenAlexAuthor = {
  id?: string;
  display_name?: string;
  works_count?: number;
  cited_by_count?: number;
  summary_stats?: { h_index?: number };
};

type OpenAlexAuthorsResponse = { results?: OpenAlexAuthor[] };
type OpenAlexWorksResponse = { results?: OpenAlexWork[] };

async function fetchOpenAlexAuthor(rawName: string) {
  const authorPayload = await fetchOpenAlexJson<OpenAlexAuthorsResponse>(
    `/authors?search=${encodeURIComponent(rawName)}&per-page=1`
  );
  const author = authorPayload?.results?.[0];
  if (!author?.id) {
    return {
      source: "openalex" as const,
      profile: {
        id: "",
        name: rawName,
        worksCount: 0,
        citedByCount: 0,
        hIndex: 0
      },
      papers: []
    };
  }

  const worksPayload = await fetchOpenAlexJson<OpenAlexWorksResponse>(
    `/works?filter=author.id:${encodeURIComponent(author.id)}&per-page=20&sort=cited_by_count:desc&select=id,doi,title,publication_year,cited_by_count,primary_location,authorships`
  );

  return {
    source: "openalex" as const,
    profile: {
      id: author.id,
      name: author.display_name ?? rawName,
      worksCount: author.works_count ?? 0,
      citedByCount: author.cited_by_count ?? 0,
      hIndex: author.summary_stats?.h_index ?? 0
    },
    papers: (worksPayload?.results ?? []).map(mapWork)
  };
}

export async function GET(_: Request, context: { params: Promise<{ name: string }> }) {
  const { name: rawParam } = await context.params;
  const rawName = decodeURIComponent(rawParam || "").trim();
  if (!rawName) {
    return NextResponse.json({ error: "Author name is required" }, { status: 400 });
  }

  const workerResult = await fetchWorkerJson<WorkerAuthorResponse>(
    `/api/authors/${encodeURIComponent(rawName)}?limit=20`
  );
  if (workerResult.ok) {
    const workerMapped = mapWorkerAuthorPayload(workerResult.data, rawName);
    if (workerMapped) {
      return NextResponse.json(workerMapped);
    }
  }

  const openAlexPayload = await fetchOpenAlexAuthor(rawName);
  if (isWorkerConfigured()) {
    return NextResponse.json(withFallbackSource(openAlexPayload, "openalex_fallback"));
  }
  return NextResponse.json(openAlexPayload);
}
