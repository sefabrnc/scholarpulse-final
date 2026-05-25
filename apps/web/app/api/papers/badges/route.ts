import { NextRequest, NextResponse } from "next/server";
import { tryProxyJson } from "../../_lib/upstream";

type BadgePayload = {
  doi: string;
  title: string | null;
  citation_count: number;
  influential_count: number;
  supports: number;
  contradicts: number;
  extends: number;
  method: number;
  data: number;
  mentions: number;
};

export async function POST(request: NextRequest) {
  let body: { dois?: unknown };
  try {
    body = (await request.json()) as { dois?: unknown };
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Invalid JSON body" } }, { status: 400 });
  }

  const rawDois = Array.isArray(body.dois) ? body.dois : [];
  const dois = [...new Set(rawDois.map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, 20);
  if (dois.length === 0) {
    return NextResponse.json({ ok: true, badges: [] as BadgePayload[] });
  }

  const proxied = await tryProxyJson<{ ok?: boolean; badges?: BadgePayload[] }>(request, "/api/papers/badges", {
    method: "POST",
    body: JSON.stringify({ dois })
  });
  if (proxied?.badges) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({
    ok: true,
    badges: dois.map((doi) => ({
      doi,
      title: null,
      citation_count: 0,
      influential_count: 0,
      supports: 0,
      contradicts: 0,
      extends: 0,
      method: 0,
      data: 0,
      mentions: 0
    })),
    mode: "local_stub"
  });
}
