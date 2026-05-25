import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyJson } from "../_lib/upstream";

function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("doi:")) {
    return trimmed.slice(4);
  }
  if (trimmed.startsWith("https://doi.org/")) {
    return trimmed.replace("https://doi.org/", "");
  }
  return trimmed;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("id");
  if (!query) {
    return NextResponse.json(errorPayload("bad_request", "id query is required"), { status: 400 });
  }

  const proxied = await tryProxyJson<{ doi?: string; normalized?: string }>(
    request,
    `/api/resolve?id=${encodeURIComponent(query)}`
  );
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({
    normalized: normalizeIdentifier(query),
    doi: normalizeIdentifier(query).toLowerCase()
  });
}
