import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyJson, userIdFromRequest } from "../../../../_lib/upstream";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: Params) {
  const { id } = await context.params;
  const edgeId = decodeURIComponent(id).trim();
  if (!edgeId) {
    return NextResponse.json(errorPayload("INVALID_EDGE_ID", "edge id is required"), { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const proxied = await tryProxyJson<Record<string, unknown>>(request, `/api/cite/edges/${encodeURIComponent(edgeId)}/report`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({
    ok: true,
    edge_id: edgeId,
    duplicate: false,
    flagged_count: 1,
    status: "active",
    mode: "local_stub",
    user_id: userIdFromRequest(request)
  });
}
