import { NextRequest, NextResponse } from "next/server";
import { getInterests } from "../_lib/memoryStore";
import { normalizeFeedItems } from "../_lib/workerNormalize";
import { tryProxyJson, userIdFromRequest } from "../_lib/upstream";

type WorkerFeedResponse = {
  items?: Array<{
    doiNorm?: string | null;
    nodeId?: string;
    reasonCode?: string;
    score?: number | null;
    title?: string | null;
    eventTs?: number;
  }>;
};

export async function GET(request: NextRequest) {
  const proxied = await tryProxyJson<WorkerFeedResponse>(request, "/api/feed");
  if (proxied) {
    return NextResponse.json({ items: normalizeFeedItems(proxied.items) });
  }

  const userId = userIdFromRequest(request);
  const interests = getInterests(userId);
  const items = interests.map((topic, index) => ({
    doi: `10.5555/${topic.replace(/\s+/g, "-")}-${index + 1}`,
    score: Number((0.92 - index * 0.08).toFixed(2)),
    reason: "topic_match",
    title: `${topic} weekly digest`
  }));
  return NextResponse.json({ items });
}
