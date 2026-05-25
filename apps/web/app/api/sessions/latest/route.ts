import { NextRequest, NextResponse } from "next/server";
import { tryProxyJson } from "../../_lib/upstream";

export async function GET(request: NextRequest) {
  const limit = request.nextUrl.searchParams.get("limit") ?? "5";
  const proxied = await tryProxyJson<{ items: unknown[] }>(request, `/api/sessions/latest?limit=${encodeURIComponent(limit)}`);
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({ items: [] });
}
