import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyResponse, userIdFromRequest } from "../../../_lib/upstream";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const proxied = await tryProxyResponse(
    request,
    `/api/papers/upload-status/${encodeURIComponent(id)}`,
    {
      method: "GET",
      headers: {
        "x-user-id": userIdFromRequest(request)
      }
    }
  );
  if (proxied) {
    return proxied;
  }

  return NextResponse.json(errorPayload("upstream_unconfigured", "upload status proxy unavailable"), {
    status: 503
  });
}
