import { NextResponse } from "next/server";
import { fetchOpenAlexJson, mapWork, normalizeDoi, type OpenAlexWork } from "../../../../lib/public/openalex";
import { fetchWorkerResponse, isWorkerConfigured, withFallbackSource } from "../../_lib/publicUpstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const doi = new URL(request.url).searchParams.get("doi")?.trim();
  if (!doi) {
    return NextResponse.json({ error: "doi query param is required" }, { status: 400 });
  }

  const normalizedDoi = normalizeDoi(doi);
  const workerResponse = await fetchWorkerResponse(
    `/api/public/paper/${encodeURIComponent(normalizedDoi)}`
  );
  if (workerResponse?.ok) {
    const payload = (await workerResponse.json()) as Record<string, unknown>;
    if (payload.item || payload.title) {
      return NextResponse.json({ source: "worker", ...payload });
    }
  }

  const work = await fetchOpenAlexJson<OpenAlexWork>(
    `/works/https://doi.org/${encodeURIComponent(normalizedDoi)}?select=id,doi,title,publication_year,cited_by_count,primary_location,authorships`
  );
  if (!work?.id) {
    return NextResponse.json({ error: "Paper metadata not found" }, { status: 404 });
  }

  const mapped = mapWork(work);
  const openAlexPayload = {
    title: mapped.title,
    authors: mapped.authors,
    abstract: null,
    published_at: mapped.year ? String(mapped.year) : null,
    journal: mapped.journal,
    url: mapped.url,
    doi: mapped.doi ?? normalizedDoi
  };

  if (isWorkerConfigured()) {
    return NextResponse.json(withFallbackSource(openAlexPayload, "openalex_fallback"));
  }
  return NextResponse.json({ ...openAlexPayload, source: "openalex" });
}
