import { NextRequest, NextResponse } from "next/server";
import { getInterests } from "../_lib/memoryStore";
import { normalizeRecommendItems } from "../_lib/workerNormalize";
import { tryProxyJson, userIdFromRequest } from "../_lib/upstream";

type WorkerRecommendResponse = {
  items?: Array<{
    doiNorm?: string | null;
    nodeId?: string;
    reason?: string;
    reasons?: string[];
    score?: number | null;
    title?: string | null;
    publicationYear?: number | null;
    venue?: string | null;
    semanticRank?: number | null;
    graphRank?: number | null;
  }>;
  seeds?: string[];
};

export async function GET(request: NextRequest) {
  const proxied = await tryProxyJson<WorkerRecommendResponse>(request, "/api/recommend");
  if (proxied) {
    return NextResponse.json({
      items: normalizeRecommendItems(proxied.items),
      seeds: proxied.seeds ?? []
    });
  }

  const interests = getInterests(userIdFromRequest(request));
  const items = interests.map((topic, index) => ({
    doi: `10.7777/recommend-${topic.replace(/\s+/g, "-")}-${index + 1}`,
    score: Number((0.88 - index * 0.06).toFixed(2)),
    reason: "semantic_similar",
    title: `${topic} related recommendation`,
    reasons: ["semantic_similar"],
    semanticRank: index + 1,
    graphRank: null
  }));
  return NextResponse.json({ items, seeds: [] });
}
