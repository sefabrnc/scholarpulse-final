import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyJson } from "../../_lib/upstream";

type SessionBody = {
  doi?: string;
  last_page?: number;
  scroll_y?: number;
  delta_seconds?: number;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as SessionBody | null;
  if (!body?.doi || typeof body.last_page !== "number") {
    return NextResponse.json(errorPayload("bad_request", "doi and last_page are required"), { status: 400 });
  }

  const proxied = await tryProxyJson(request, "/api/sessions/update", {
    method: "POST",
    body: JSON.stringify(body)
  });
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({
    ok: true,
    item: {
      doi: body.doi,
      last_page: body.last_page,
      scroll_y: body.scroll_y ?? 0,
      total_seconds: body.delta_seconds ?? 0
    }
  });
}
