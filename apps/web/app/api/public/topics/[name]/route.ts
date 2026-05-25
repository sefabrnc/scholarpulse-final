import { NextResponse } from "next/server";
import { fetchOpenAlexJson, mapWork, type OpenAlexWork } from "../../../../../lib/public/openalex";
import { fetchWorkerJson, isWorkerConfigured, mapWorkerTopicPayload, withFallbackSource } from "../../../_lib/publicUpstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpenAlexWorksResponse = { results?: OpenAlexWork[] };

async function fetchOpenAlexTopic(topicName: string) {
  const worksPayload = await fetchOpenAlexJson<OpenAlexWorksResponse>(
    `/works?search=${encodeURIComponent(topicName)}&per-page=25&select=id,doi,title,publication_year,cited_by_count,primary_location,authorships`
  );

  const papers = (worksPayload?.results ?? []).map(mapWork);
  const timelineMap = new Map<number, { year: number; paperCount: number; citationTotal: number }>();

  for (const paper of papers) {
    if (!paper.year) {
      continue;
    }
    const current = timelineMap.get(paper.year) ?? {
      year: paper.year,
      paperCount: 0,
      citationTotal: 0
    };
    current.paperCount += 1;
    current.citationTotal += paper.citedByCount;
    timelineMap.set(paper.year, current);
  }

  return {
    source: "openalex" as const,
    topic: topicName,
    timeline: [...timelineMap.values()].sort((a, b) => a.year - b.year),
    papers
  };
}

export async function GET(_: Request, context: { params: Promise<{ name: string }> }) {
  const { name: rawParam } = await context.params;
  const topicName = decodeURIComponent(rawParam || "").trim();
  if (!topicName) {
    return NextResponse.json({ error: "Topic name is required" }, { status: 400 });
  }

  const encoded = encodeURIComponent(topicName);
  const [evolutionResult, papersResult] = await Promise.all([
    fetchWorkerJson<{ items?: Array<{ year: number; paper_count: number; total_rank_signal: number }> }>(
      `/api/topics/${encoded}/evolution?top_per_year=5`
    ),
    fetchWorkerJson<{ items?: Array<{ nodeId: string; title: string; doiNorm: string | null; publicationYear: number | null; rankSignal: number | null }> }>(
      `/api/topics/${encoded}/papers?limit=25`
    )
  ]);

  if (evolutionResult.ok && papersResult.ok) {
    const workerMapped = mapWorkerTopicPayload(evolutionResult.data, papersResult.data, topicName);
    if (workerMapped) {
      return NextResponse.json(workerMapped);
    }
  }

  const openAlexPayload = await fetchOpenAlexTopic(topicName);
  if (isWorkerConfigured()) {
    return NextResponse.json(withFallbackSource(openAlexPayload, "openalex_fallback"));
  }
  return NextResponse.json(openAlexPayload);
}
