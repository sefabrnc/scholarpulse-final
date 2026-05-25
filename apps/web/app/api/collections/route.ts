import { NextRequest, NextResponse } from "next/server";
import { addCollection, getCollections } from "../_lib/memoryStore";
import { errorPayload, tryProxyJson, userIdFromRequest } from "../_lib/upstream";

type CollectionBody = {
  name?: string;
  description?: string;
};

function normalizeCollections(payload: { items?: unknown[]; collections?: unknown[] }) {
  const raw = (payload.items ?? payload.collections ?? []) as Array<{
    id: string;
    name: string;
    description?: string | null;
    paper_count?: number;
    count?: number;
  }>;
  return raw.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description ?? null,
    count: item.paper_count ?? item.count ?? 0,
    paper_count: item.paper_count ?? item.count ?? 0
  }));
}

export async function GET(request: NextRequest) {
  const proxied = await tryProxyJson<{ items?: unknown[]; collections?: unknown[] }>(
    request,
    "/api/collections"
  );
  if (proxied) {
    return NextResponse.json({ collections: normalizeCollections(proxied), items: proxied.items ?? proxied.collections });
  }
  return NextResponse.json({ collections: getCollections(userIdFromRequest(request)) });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CollectionBody | null;
  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json(errorPayload("bad_request", "name is required"), { status: 400 });
  }

  const proxied = await tryProxyJson<{ item?: unknown; collection?: unknown }>(request, "/api/collections", {
    method: "POST",
    body: JSON.stringify({ name, description: body?.description })
  });
  if (proxied) {
    return NextResponse.json(proxied);
  }

  const collection = addCollection(userIdFromRequest(request), name);
  return NextResponse.json({ ok: true, collection });
}
