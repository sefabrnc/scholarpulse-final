import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyResponse, userIdFromRequest } from "../../_lib/upstream";

export async function POST(request: NextRequest) {
  const proxied = await tryProxyResponse(request, "/api/papers/upload", {
    method: "POST",
    headers: {
      "x-user-id": userIdFromRequest(request),
      "content-type": request.headers.get("content-type") ?? "application/json"
    },
    body: await request.arrayBuffer()
  });
  if (proxied) {
    return proxied;
  }

  return NextResponse.json(
    errorPayload("upstream_unconfigured", "SCHOLARPULSE_API_BASE_URL is not configured for upload proxy"),
    { status: 503 }
  );
}
