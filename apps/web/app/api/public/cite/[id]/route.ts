import { NextResponse } from "next/server";
import { fetchOpenAlexJson, mapWork, normalizeDoi, type OpenAlexWork } from "../../../../../lib/public/openalex";
import { fetchWorkerResponse, isWorkerConfigured, withFallbackSource } from "../../../_lib/publicUpstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchByToken(token: string): Promise<OpenAlexWork | null> {
  const clean = token.trim();
  if (!clean) {
    return null;
  }
  if (clean.startsWith("10.")) {
    const byDoi = await fetchOpenAlexJson<OpenAlexWork>(
      `/works/https://doi.org/${encodeURIComponent(normalizeDoi(clean))}?select=id,doi,title,publication_year,cited_by_count,primary_location,authorships`
    );
    if (byDoi?.id) {
      return byDoi;
    }
  }
  return fetchOpenAlexJson<OpenAlexWork>(
    `/works/${encodeURIComponent(clean)}?select=id,doi,title,publication_year,cited_by_count,primary_location,authorships`
  );
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawParam } = await context.params;
  const id = decodeURIComponent(rawParam || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const workerResponse = await fetchWorkerResponse(`/api/public/cite/${encodeURIComponent(id)}`);
  if (workerResponse?.ok) {
    const payload = (await workerResponse.json()) as Record<string, unknown>;
    if (payload.edge || payload.source || payload.target) {
      return NextResponse.json({ source: "worker", ...payload });
    }
  }

  const [leftToken, rightToken] = id.split("__", 2);
  const [source, target] = await Promise.all([
    fetchByToken(leftToken),
    rightToken ? fetchByToken(rightToken) : Promise.resolve(null)
  ]);

  const openAlexPayload = {
    id,
    source: source ? mapWork(source) : null,
    target: target ? mapWork(target) : null
  };

  if (isWorkerConfigured()) {
    return NextResponse.json(withFallbackSource(openAlexPayload, "openalex_fallback"));
  }
  return NextResponse.json({ ...openAlexPayload, source: "openalex" });
}
