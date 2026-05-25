import { NextRequest, NextResponse } from "next/server";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(request: NextRequest) {
  const doi = request.nextUrl.searchParams.get("doi")?.trim();
  const url = request.nextUrl.searchParams.get("url")?.trim();
  if (!doi && !url) {
    return jsonError(400, "doi or url query parameter is required");
  }

  const base = process.env.SCHOLARPULSE_API_BASE_URL;
  if (!base) {
    return jsonError(503, "SCHOLARPULSE_API_BASE_URL is not configured");
  }

  const upstreamUrl = new URL("/api/pdf/proxy", base);
  if (doi) {
    upstreamUrl.searchParams.set("doi", doi);
  }
  if (url) {
    upstreamUrl.searchParams.set("url", url);
  }

  const headers = new Headers();
  headers.set("accept", "application/pdf,*/*;q=0.8");
  const range = request.headers.get("range");
  if (range) {
    headers.set("range", range);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers,
      cache: "no-store"
    });
  } catch {
    return jsonError(502, "failed to reach upstream proxy");
  }

  if (!upstream.ok || !upstream.body) {
    const fallback = await upstream.text().catch(() => "");
    return NextResponse.json(
      {
        ok: false,
        error: fallback || `upstream failed with status ${upstream.status}`
      },
      { status: upstream.status || 502 }
    );
  }

  const responseHeaders = new Headers();
  for (const key of [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
    "vary"
  ]) {
    const value = upstream.headers.get(key);
    if (value) {
      responseHeaders.set(key, value);
    }
  }
  responseHeaders.set("x-proxy-through", "nextjs");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
}
