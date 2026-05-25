import { NextRequest, NextResponse } from "next/server";
import { tryProxyJson } from "../../../_lib/upstream";

type Params = {
  params: Promise<{ doi: string }>;
};

export async function GET(request: NextRequest, context: Params) {
  const { doi } = await context.params;
  const decoded = decodeURIComponent(doi);
  const proxied = await tryProxyJson<Record<string, unknown>>(
    request,
    `/api/papers/${encodeURIComponent(decoded)}/badge`
  );
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({
    ok: true,
    doi: decoded,
    title: null,
    citation_count: 0,
    influential_count: 0,
    supports: 0,
    contradicts: 0,
    extends: 0,
    method: 0,
    data: 0,
    mentions: 0,
    mode: "local_stub"
  });
}
