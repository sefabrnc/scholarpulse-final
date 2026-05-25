import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyResponse, userIdFromRequest } from "../../_lib/upstream";

export async function DELETE(request: NextRequest) {
  const proxied = await tryProxyResponse(request, "/api/user/me", { method: "DELETE" });
  if (proxied) {
    return proxied;
  }

  const userId = userIdFromRequest(request);
  return NextResponse.json({
    ok: true,
    deleted: {
      user_id: userId,
      mode: "local_stub"
    }
  });
}

export async function GET(request: NextRequest) {
  const userId = userIdFromRequest(request);
  return NextResponse.json({
    user_id: userId,
    profile_source: process.env.SCHOLARPULSE_API_BASE_URL ? "upstream_pending" : "local"
  });
}
