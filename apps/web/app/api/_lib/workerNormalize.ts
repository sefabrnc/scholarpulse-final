type WorkerFeedRow = {
  doiNorm?: string | null;
  doi?: string | null;
  nodeId?: string;
  reasonCode?: string;
  reason?: string;
  score?: number | null;
  title?: string | null;
  eventTs?: number;
};

type WorkerRecommendRow = WorkerFeedRow & {
  reasons?: string[];
  semanticRank?: number | null;
  graphRank?: number | null;
  publicationYear?: number | null;
  venue?: string | null;
};

export type WebFeedItem = {
  doi: string;
  score: number;
  reason: string;
  title: string;
  created_at?: string;
  publicationYear?: number | null;
  venue?: string | null;
  reasons?: string[];
  semanticRank?: number | null;
  graphRank?: number | null;
};

function pickDoi(row: WorkerFeedRow): string {
  const doi = row.doiNorm ?? row.doi ?? row.nodeId;
  return doi && doi.length > 0 ? doi : "unknown";
}

export function normalizeFeedItems(rows: WorkerFeedRow[] | undefined): WebFeedItem[] {
  return (rows ?? []).map((row) => ({
    doi: pickDoi(row),
    score: Number(row.score ?? 0),
    reason: row.reasonCode ?? row.reason ?? "feed",
    title: row.title ?? pickDoi(row),
    created_at: row.eventTs ? new Date(row.eventTs * 1000).toISOString() : undefined
  }));
}

export function normalizeRecommendItems(rows: WorkerRecommendRow[] | undefined): WebFeedItem[] {
  return (rows ?? []).map((row) => ({
    doi: pickDoi(row),
    score: Number(row.score ?? 0),
    reason: row.reason ?? row.reasonCode ?? "recommend",
    title: row.title ?? pickDoi(row),
    publicationYear: row.publicationYear ?? null,
    venue: row.venue ?? null,
    reasons: row.reasons,
    semanticRank: row.semanticRank ?? null,
    graphRank: row.graphRank ?? null
  }));
}
