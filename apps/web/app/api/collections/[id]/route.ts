import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyJson } from "../../_lib/upstream";

type PatchBody = {
  name?: string;
  description?: string | null;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) {
    return NextResponse.json(errorPayload("bad_request", "body is required"), { status: 400 });
  }

  const proxied = await tryProxyJson(request, `/api/collections/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({ ok: true, id });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const proxied = await tryProxyJson(request, `/api/collections/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({ ok: true, deleted: id });
}
