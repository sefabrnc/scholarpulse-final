import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyResponse, userIdFromRequest } from "../../_lib/upstream";

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "application/json";
  const proxied = await tryProxyResponse(request, "/api/library/add", {
    method: "POST",
    headers: {
      "x-user-id": userIdFromRequest(request),
      "content-type": contentType
    },
    body: await request.arrayBuffer()
  });
  if (proxied) {
    return proxied;
  }

  return NextResponse.json(
    errorPayload("upstream_unconfigured", "SCHOLARPULSE_API_BASE_URL is not configured for library add proxy"),
    { status: 503 }
  );
}
