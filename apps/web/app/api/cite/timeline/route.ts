import { NextRequest, NextResponse } from "next/server";
import type { NormRect, TimelineItem, TimelineResponse, UserTier } from "../../../../types/citation";

const FREE_LIMIT = 10;
const PRO_LIMIT = 100;

type MaybeTimelinePayload = {
  ok?: boolean;
  id?: string;
  plan?: UserTier;
  tierLimit?: number;
  limit?: number;
  items?: unknown[];
};

function parseTier(search: URLSearchParams): UserTier {
  const input = (search.get("plan") ?? search.get("tier") ?? "free").toLowerCase();
  return input === "pro" ? "pro" : "free";
}

function parseLimit(search: URLSearchParams, tierLimit: number): number {
  const input = Number.parseInt(search.get("limit") ?? `${tierLimit}`, 10);
  if (!Number.isFinite(input) || input < 1) {
    return tierLimit;
  }
  return Math.min(input, tierLimit);
}

function parseEvidenceRef(evidenceRef: string | null | undefined): {
  ceScore?: number;
  confidenceTier?: string;
  intentConfidence?: number;
  refLabel?: string;
} {
  if (!evidenceRef) {
    return {};
  }
  const parts = evidenceRef.split(";");
  const parsed: {
    ceScore?: number;
    confidenceTier?: string;
    intentConfidence?: number;
    refLabel?: string;
  } = {};
  for (const part of parts) {
    const [key, rawValue] = part.split(":");
    if (!key || !rawValue) {
      continue;
    }
    if (key === "ce") {
      const value = Number(rawValue);
      if (Number.isFinite(value)) {
        parsed.ceScore = value;
      }
    }
    if (key === "tier") {
      parsed.confidenceTier = rawValue;
    }
    if (key === "intent") {
      const value = Number(rawValue);
      if (Number.isFinite(value)) {
        parsed.intentConfidence = value;
      }
    }
    if (key === "ref") {
      parsed.refLabel = `[${rawValue}]`;
    }
  }
  return parsed;
}

function parseNormRect(item: Record<string, unknown>): NormRect | null {
  const normRectRecord = item.normRect as Record<string, unknown> | undefined;
  if (
    normRectRecord &&
    typeof normRectRecord.x === "number" &&
    typeof normRectRecord.y === "number" &&
    typeof normRectRecord.width === "number" &&
    typeof normRectRecord.height === "number"
  ) {
    return {
      x: normRectRecord.x,
      y: normRectRecord.y,
      width: normRectRecord.width,
      height: normRectRecord.height
    };
  }
  return null;
}

function isInfluentialEdge(relationType: string | null, ceScore: number | null): boolean {
  const relation = (relationType ?? "").toLowerCase();
  if (relation === "supports" || relation === "extends") {
    return true;
  }
  return (ceScore ?? 0) >= 0.95;
}

function normalizeItem(item: Record<string, unknown>, index: number): TimelineItem {
  const publicationYear = Number(item.publicationYear ?? item.publication_year ?? null);
  const page = Number(item.page ?? null);
  const evidence = parseEvidenceRef(
    typeof item.evidenceRef === "string"
      ? item.evidenceRef
      : typeof item.evidence_ref === "string"
        ? item.evidence_ref
        : null
  );
  const ceScore = Number(
    item.ceScore ?? item.ce_score ?? evidence.ceScore ?? item.weight ?? 0.9
  );
  const relationType = String(
    item.relationType ?? item.relation_type ?? item.edgeType ?? item.edge_type ?? "mentions"
  );
  const confidenceTier = String(
    item.confidenceTier ?? item.confidence_tier ?? evidence.confidenceTier ?? "high"
  );
  const intentConfidence = Number(
    item.intentConfidence ?? item.intent_confidence ?? evidence.intentConfidence ?? NaN
  );

  return {
    edgeId: String(item.edgeId ?? item.edge_id ?? `edge-${index + 1}`),
    relatedNodeId: String(item.relatedNodeId ?? item.related_node_id ?? `node-${index + 1}`),
    title: String(item.title ?? "Untitled citation"),
    publicationYear: Number.isFinite(publicationYear) ? publicationYear : null,
    venue: item.venue ? String(item.venue) : null,
    doiNorm: item.doiNorm ? String(item.doiNorm) : null,
    direction: item.direction === "inbound" ? "inbound" : "outbound",
    edgeType: item.edgeType ? String(item.edgeType) : null,
    relationType,
    authorsText: item.authorsText ? String(item.authorsText) : null,
    topicTerms: item.topicTerms ? String(item.topicTerms) : null,
    page: Number.isFinite(page) && page > 0 ? page : null,
    ceScore: Number.isFinite(ceScore) ? ceScore : null,
    confidenceTier,
    intentConfidence: Number.isFinite(intentConfidence) ? intentConfidence : null,
    isInfluential: isInfluentialEdge(relationType, Number.isFinite(ceScore) ? ceScore : null),
    refLabel: item.refLabel ? String(item.refLabel) : evidence.refLabel ?? null,
    normRect: parseNormRect(item)
  };
}

function buildMockTimeline(id: string, limit: number): TimelineItem[] {
  const base: TimelineItem[] = [
    {
      edgeId: `edge-${id}-1`,
      relatedNodeId: "node-transformer-2017",
      title: "Attention Is All You Need",
      publicationYear: 2017,
      venue: "NeurIPS",
      doiNorm: "10.5555/3295222.3295349",
      direction: "outbound",
      edgeType: "references",
      relationType: "method",
      authorsText: "Vaswani et al.",
      topicTerms: "attention, transformer",
      page: 3,
      ceScore: 0.96,
      confidenceTier: "high",
      intentConfidence: 0.88,
      isInfluential: true,
      refLabel: "[12]",
      normRect: null
    },
    {
      edgeId: `edge-${id}-2`,
      relatedNodeId: "node-bert-2018",
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      publicationYear: 2018,
      venue: "NAACL",
      doiNorm: "10.48550/arXiv.1810.04805",
      direction: "inbound",
      edgeType: "supports",
      relationType: "supports",
      authorsText: "Devlin et al.",
      topicTerms: "language model, transfer learning",
      page: 4,
      ceScore: 0.92,
      confidenceTier: "medium",
      intentConfidence: 0.74,
      isInfluential: true,
      refLabel: "(Smith 2020)",
      normRect: null
    },
    {
      edgeId: `edge-${id}-3`,
      relatedNodeId: "node-rag-2020",
      title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
      publicationYear: 2020,
      venue: "NeurIPS",
      doiNorm: "10.48550/arXiv.2005.11401",
      direction: "inbound",
      edgeType: "mentions",
      relationType: "mentions",
      authorsText: "Lewis et al.",
      topicTerms: "retrieval, generation",
      page: 6,
      ceScore: 0.9,
      confidenceTier: "medium",
      intentConfidence: 0.61,
      isInfluential: false,
      refLabel: "[Zhang et al.]",
      normRect: null
    }
  ];
  return base.slice(0, limit);
}

function parseSeedIds(search: URLSearchParams): string[] {
  const multi = search.get("ids") ?? search.get("seeds");
  if (multi && multi.trim()) {
    const unique = new Set<string>();
    for (const part of multi.split(",")) {
      const value = part.trim();
      if (value) {
        unique.add(value);
      }
    }
    return [...unique];
  }
  const single = search.get("id")?.trim();
  return single ? [single] : [];
}

function sortTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((left, right) => {
    if (left.isInfluential !== right.isInfluential) {
      return left.isInfluential ? -1 : 1;
    }
    const yearLeft = left.publicationYear ?? 9999;
    const yearRight = right.publicationYear ?? 9999;
    if (yearLeft !== yearRight) {
      return yearLeft - yearRight;
    }
    return (right.ceScore ?? 0) - (left.ceScore ?? 0);
  });
}

function mergeTimelineItems(seedResponses: TimelineResponse[], totalLimit: number): {
  items: TimelineItem[];
  perSeed: Record<string, number>;
} {
  const perSeed: Record<string, number> = {};
  const byRelated = new Map<string, TimelineItem>();

  for (const response of seedResponses) {
    perSeed[response.id] = response.items.length;
    for (const item of response.items) {
      const existing = byRelated.get(item.relatedNodeId);
      if (!existing || (item.ceScore ?? 0) > (existing.ceScore ?? 0)) {
        byRelated.set(item.relatedNodeId, item);
      }
    }
  }

  return {
    items: sortTimelineItems([...byRelated.values()]).slice(0, totalLimit),
    perSeed
  };
}

async function fetchFromUpstream(
  id: string,
  plan: UserTier,
  limit: number
): Promise<TimelineResponse | null> {
  const base = process.env.SCHOLARPULSE_API_BASE_URL?.trim();
  if (!base) {
    return null;
  }

  const upstreamUrl = new URL("/api/cite/timeline", base);
  upstreamUrl.searchParams.set("id", id);
  upstreamUrl.searchParams.set("plan", plan);
  upstreamUrl.searchParams.set("limit", String(limit));

  try {
    const response = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as MaybeTimelinePayload;
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items = rawItems
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item, index) => normalizeItem(item, index));
    return {
      ok: true,
      id,
      plan,
      tierLimit: plan === "pro" ? PRO_LIMIT : FREE_LIMIT,
      limit,
      items
    };
  } catch {
    return null;
  }
}

async function fetchSeedTimeline(
  id: string,
  plan: UserTier,
  limit: number
): Promise<TimelineResponse | "upstream_error"> {
  const base = process.env.SCHOLARPULSE_API_BASE_URL?.trim();
  if (!base) {
    return {
      ok: true,
      id,
      plan,
      tierLimit: plan === "pro" ? PRO_LIMIT : FREE_LIMIT,
      limit,
      items: buildMockTimeline(id, limit)
    };
  }

  const upstreamPayload = await fetchFromUpstream(id, plan, limit);
  if (upstreamPayload) {
    return upstreamPayload;
  }
  return "upstream_error";
}

export async function GET(request: NextRequest) {
  const seedIds = parseSeedIds(request.nextUrl.searchParams);
  if (seedIds.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "id or ids query parameter is required"
      },
      { status: 400 }
    );
  }

  const plan = parseTier(request.nextUrl.searchParams);
  const tierLimit = plan === "pro" ? PRO_LIMIT : FREE_LIMIT;
  const limit = parseLimit(request.nextUrl.searchParams, tierLimit);

  if (seedIds.length === 1) {
    const payload = await fetchSeedTimeline(seedIds[0], plan, limit);
    if (payload === "upstream_error") {
      return NextResponse.json(
        {
          ok: false,
          error: "Timeline upstream unavailable",
          source: "worker_error"
        },
        { status: 502 }
      );
    }
    return NextResponse.json(payload);
  }

  const perSeedLimit = Math.max(1, Math.ceil(limit / seedIds.length));
  const seedResponses = await Promise.all(
    seedIds.map((seedId) => fetchSeedTimeline(seedId, plan, perSeedLimit))
  );
  if (seedResponses.some((response) => response === "upstream_error")) {
    return NextResponse.json(
      {
        ok: false,
        error: "Timeline upstream unavailable for one or more seeds",
        source: "worker_error"
      },
      { status: 502 }
    );
  }

  const merged = mergeTimelineItems(seedResponses as TimelineResponse[], limit);
  const payload: TimelineResponse = {
    ok: true,
    id: seedIds.join(","),
    plan,
    tierLimit,
    limit,
    items: merged.items,
    seeds: seedIds,
    perSeed: merged.perSeed
  };
  return NextResponse.json(payload);
}
