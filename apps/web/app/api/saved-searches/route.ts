import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyJson, userIdFromRequest } from "../_lib/upstream";

type SavedSearchRow = {
  id: string;
  name: string;
  query: string;
  filters?: Record<string, unknown> | null;
  created_at?: number;
  last_run_at?: number | null;
};

const localSavedSearches = new Map<string, SavedSearchRow[]>();

function getLocalRows(userId: string): SavedSearchRow[] {
  if (!localSavedSearches.has(userId)) {
    localSavedSearches.set(userId, []);
  }
  return localSavedSearches.get(userId) ?? [];
}

export async function GET(request: NextRequest) {
  const proxied = await tryProxyJson<{ items?: SavedSearchRow[] }>(request, "/api/saved-searches");
  if (proxied) {
    return NextResponse.json(proxied);
  }

  const userId = userIdFromRequest(request);
  return NextResponse.json({ ok: true, items: getLocalRows(userId), mode: "local_stub" });
}

export async function POST(request: NextRequest) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const proxied = await tryProxyJson<Record<string, unknown>>(request, "/api/saved-searches", {
    method: "POST",
    body: JSON.stringify(body)
  });
  if (proxied) {
    return NextResponse.json(proxied);
  }

  const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const userId = userIdFromRequest(request);
  const row: SavedSearchRow = {
    id: `ss_${Date.now()}`,
    name: typeof payload.name === "string" ? payload.name : "Saved search",
    query: typeof payload.query === "string" ? payload.query : JSON.stringify(payload.query ?? ""),
    filters: typeof payload.filters === "object" && payload.filters !== null ? (payload.filters as Record<string, unknown>) : null,
    created_at: Math.floor(Date.now() / 1000),
    last_run_at: null
  };
  const rows = getLocalRows(userId);
  rows.unshift(row);
  localSavedSearches.set(userId, rows);
  return NextResponse.json({ ok: true, item: row, mode: "local_stub" });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json(errorPayload("INVALID_ID", "id query parameter is required"), { status: 400 });
  }

  const proxied = await tryProxyJson<Record<string, unknown>>(
    request,
    `/api/saved-searches/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (proxied) {
    return NextResponse.json(proxied);
  }

  const userId = userIdFromRequest(request);
  const rows = getLocalRows(userId).filter((row) => row.id !== id);
  localSavedSearches.set(userId, rows);
  return NextResponse.json({ ok: true, deleted: id, mode: "local_stub" });
}
