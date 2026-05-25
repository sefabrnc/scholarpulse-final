import { NextResponse } from "next/server";
import { fetchOpenAlexJson, mapWork, normalizeDoi, type OpenAlexWork } from "../../../../../lib/public/openalex";
import { fetchWorkerResponse, isWorkerConfigured, withFallbackSource } from "../../../_lib/publicUpstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpenAlexWorkResponse = OpenAlexWork & {
  referenced_works?: string[];
  cited_by_api_url?: string;
};

type OpenAlexWorksResponse = { results?: OpenAlexWork[] };

async function fetchWorkByToken(token: string): Promise<OpenAlexWorkResponse | null> {
  const clean = token.trim();
  if (!clean) {
    return null;
  }

  const maybeDoi = clean.startsWith("10.") ? normalizeDoi(clean) : "";
  if (maybeDoi) {
    const byDoi = await fetchOpenAlexJson<OpenAlexWorkResponse>(
      `/works/https://doi.org/${encodeURIComponent(maybeDoi)}?select=id,doi,title,publication_year,cited_by_count,primary_location,authorships,referenced_works,cited_by_api_url`
    );
    if (byDoi?.id) {
      return byDoi;
    }
  }

  const byId = await fetchOpenAlexJson<OpenAlexWorkResponse>(
    `/works/${encodeURIComponent(clean)}?select=id,doi,title,publication_year,cited_by_count,primary_location,authorships,referenced_works,cited_by_api_url`
  );
  if (byId?.id) {
    return byId;
  }

  const search = await fetchOpenAlexJson<OpenAlexWorksResponse>(
    `/works?search=${encodeURIComponent(clean)}&per-page=1&select=id,doi,title,publication_year,cited_by_count,primary_location,authorships,referenced_works,cited_by_api_url`
  );
  return (search?.results?.[0] as OpenAlexWorkResponse | undefined) ?? null;
}

async function fetchOpenAlexTimeline(sid: string) {
  const root = await fetchWorkByToken(sid);
  if (!root?.id) {
    return { sid, root: null, events: [] };
  }

  const referenced = (root.referenced_works ?? []).slice(0, 6);
  const citedByUrl = root.cited_by_api_url
    ? `${root.cited_by_api_url}${root.cited_by_api_url.includes("?") ? "&" : "?"}per-page=6&select=id,doi,title,publication_year,cited_by_count,primary_location,authorships`
    : "";

  const [referencedItems, citedByPayload] = await Promise.all([
    referenced.length > 0
      ? Promise.all(
          referenced.map((workId) =>
            fetchOpenAlexJson<OpenAlexWork>(
              `/works/${encodeURIComponent(workId.split("/").pop() || workId)}?select=id,doi,title,publication_year,cited_by_count,primary_location,authorships`
            )
          )
        )
      : Promise.resolve<(OpenAlexWork | null)[]>([]),
    citedByUrl
      ? fetchOpenAlexJson<OpenAlexWorksResponse>(citedByUrl.replace("https://api.openalex.org", ""))
      : Promise.resolve<OpenAlexWorksResponse | null>(null)
  ]);

  const events = [
    ...referencedItems.filter((item): item is OpenAlexWork => Boolean(item)).map((work) => ({ relation: "references", ...mapWork(work) })),
    ...(citedByPayload?.results ?? []).map((work) => ({ relation: "cited_by", ...mapWork(work) }))
  ].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

  return {
    sid,
    root: mapWork(root),
    events
  };
}

export async function GET(_: Request, context: { params: Promise<{ sid: string }> }) {
  const { sid: rawParam } = await context.params;
  const sid = decodeURIComponent(rawParam || "").trim();
  if (!sid) {
    return NextResponse.json({ error: "sid is required" }, { status: 400 });
  }

  const workerResponse = await fetchWorkerResponse(`/api/public/timeline/${encodeURIComponent(sid)}?limit=20`);
  if (workerResponse?.ok) {
    const payload = (await workerResponse.json()) as Record<string, unknown>;
    if (payload.items || payload.root || payload.source) {
      return NextResponse.json({ source: "worker", ...payload });
    }
  }

  const openAlexPayload = await fetchOpenAlexTimeline(sid);
  if (isWorkerConfigured()) {
    return NextResponse.json(withFallbackSource(openAlexPayload, "openalex_fallback"));
  }
  return NextResponse.json({ ...openAlexPayload, source: "openalex" });
}
