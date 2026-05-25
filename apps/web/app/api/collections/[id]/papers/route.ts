import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyJson } from "../../../_lib/upstream";

type PaperBody = {
  doi?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as PaperBody | null;
  if (!body?.doi?.trim()) {
    return NextResponse.json(errorPayload("bad_request", "doi is required"), { status: 400 });
  }

  const proxied = await tryProxyJson(
    request,
    `/api/collections/${encodeURIComponent(id)}/papers`,
    {
      method: "POST",
      body: JSON.stringify({ doi: body.doi.trim() })
    }
  );
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({ ok: true, collection_id: id, doi: body.doi.trim() });
}
