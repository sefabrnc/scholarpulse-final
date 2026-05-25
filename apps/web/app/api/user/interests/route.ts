import { NextRequest, NextResponse } from "next/server";
import { getInterests, setInterests } from "../../_lib/memoryStore";
import { errorPayload, tryProxyJson, userIdFromRequest } from "../../_lib/upstream";

export async function GET(request: NextRequest) {
  const proxied = await tryProxyJson<{ topics: string[] }>(request, "/api/user/interests");
  if (proxied) {
    return NextResponse.json(proxied);
  }
  return NextResponse.json({ topics: getInterests(userIdFromRequest(request)) });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { topics?: unknown } | null;
  const topics = body?.topics;
  if (!Array.isArray(topics)) {
    return NextResponse.json(errorPayload("bad_request", "topics must be an array"), { status: 400 });
  }

  const normalized = topics
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  setInterests(userIdFromRequest(request), normalized);
  return NextResponse.json({ topics: normalized });
}
