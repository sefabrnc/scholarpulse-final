type WorkerAuthorItem = {
  nodeId: string;
  title: string;
  doiNorm: string | null;
  publicationYear: number | null;
  venue?: string | null;
  rankSignal: number | null;
};

export type WorkerAuthorResponse = {
  ok?: boolean;
  query?: string;
  summary?: {
    authorName: string;
    paperCount: number;
    edgeCount: number;
    totalRankSignal: number;
  };
  items?: WorkerAuthorItem[];
};

type WorkerTopicEvolutionItem = {
  year: number;
  paper_count: number;
  total_rank_signal: number;
};

type WorkerTopicPaperItem = {
  nodeId: string;
  title: string;
  doiNorm: string | null;
  publicationYear: number | null;
  rankSignal: number | null;
};

export type PublicDataSource = "worker" | "openalex" | "openalex_fallback";

export type WorkerFetchResult<T> =
  | { ok: true; data: T; source: "worker" }
  | { ok: false; configured: boolean; status: number | null };

function workerBaseUrl(): string | null {
  const baseUrl = process.env.SCHOLARPULSE_API_BASE_URL?.trim();
  return baseUrl && baseUrl.length > 0 ? baseUrl : null;
}

export function isWorkerConfigured(): boolean {
  return workerBaseUrl() !== null;
}

export async function fetchWorkerJson<T>(path: string): Promise<WorkerFetchResult<T>> {
  const baseUrl = workerBaseUrl();
  if (!baseUrl) {
    return { ok: false, configured: false, status: null };
  }

  try {
    const response = await fetch(new URL(path, baseUrl).toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) {
      return { ok: false, configured: true, status: response.status };
    }
    return { ok: true, data: (await response.json()) as T, source: "worker" };
  } catch {
    return { ok: false, configured: true, status: null };
  }
}

export async function fetchWorkerResponse(path: string): Promise<Response | null> {
  const baseUrl = workerBaseUrl();
  if (!baseUrl) {
    return null;
  }

  try {
    return await fetch(new URL(path, baseUrl).toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
  } catch {
    return null;
  }
}

export function mapWorkerAuthorPayload(payload: WorkerAuthorResponse, fallbackName: string) {
  const summary = payload.summary;
  const hasData = (payload.items?.length ?? 0) > 0 || (summary?.paperCount ?? 0) > 0;

  if (!hasData) {
    return null;
  }

  return {
    source: "worker" as const,
    profile: {
      id: summary?.authorName ?? fallbackName,
      name: summary?.authorName ?? fallbackName,
      worksCount: summary?.paperCount ?? 0,
      citedByCount: Math.round(summary?.totalRankSignal ?? 0),
      hIndex: summary?.edgeCount ?? 0
    },
    papers: (payload.items ?? []).map((item) => ({
      id: item.nodeId,
      doi: item.doiNorm,
      title: item.title,
      year: item.publicationYear,
      citedByCount: Math.round(item.rankSignal ?? 0),
      url: item.doiNorm ? `https://doi.org/${item.doiNorm}` : "",
      authors: [] as string[]
    }))
  };
}

export function mapWorkerTopicPayload(
  evolution: { items?: WorkerTopicEvolutionItem[] } | null,
  papers: { items?: WorkerTopicPaperItem[] } | null,
  topicName: string
) {
  const timeline = (evolution?.items ?? []).map((point) => ({
    year: point.year,
    paperCount: point.paper_count,
    citationTotal: Math.round(point.total_rank_signal)
  }));

  const mappedPapers = (papers?.items ?? []).map((item) => ({
    id: item.nodeId,
    doi: item.doiNorm,
    title: item.title,
    year: item.publicationYear,
    citedByCount: Math.round(item.rankSignal ?? 0),
    url: item.doiNorm ? `https://doi.org/${item.doiNorm}` : "",
    authors: [] as string[]
  }));

  if (timeline.length === 0 && mappedPapers.length === 0) {
    return null;
  }

  return {
    source: "worker" as const,
    topic: topicName,
    timeline,
    papers: mappedPapers
  };
}

export function withFallbackSource<T extends Record<string, unknown>>(
  payload: T,
  source: PublicDataSource
): T & { source: PublicDataSource; workerUnavailable?: boolean } {
  if (source === "openalex_fallback") {
    return { ...payload, source, workerUnavailable: true };
  }
  return { ...payload, source };
}
