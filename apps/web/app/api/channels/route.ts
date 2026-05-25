import { NextRequest, NextResponse } from "next/server";
import { getChannels } from "../_lib/memoryStore";
import { tryProxyJson } from "../_lib/upstream";

export async function GET(request: NextRequest) {
  const proxied = await tryProxyJson<{ channels: unknown[] }>(request, "/api/channels");
  if (proxied) {
    return NextResponse.json(proxied);
  }
  return NextResponse.json({ channels: getChannels() });
}
