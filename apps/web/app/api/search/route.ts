import { NextRequest, NextResponse } from "next/server";
import { tryProxyJson } from "../_lib/upstream";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.toString();
  const path = query ? `/api/search?${query}` : "/api/search";
  const proxied = await tryProxyJson<Record<string, unknown>>(request, path);
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Hybrid search requires SCHOLARPULSE_API_BASE_URL"
      }
    },
    { status: 503 }
  );
}
