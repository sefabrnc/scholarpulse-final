import { NextRequest, NextResponse } from "next/server";
import { deleteAnnotation } from "../../_lib/memoryStore";
import { errorPayload, tryProxyJson, tryProxyResponse, userIdFromRequest } from "../../_lib/upstream";

type PatchBody = {
  note?: string | null;
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) {
    return NextResponse.json(errorPayload("bad_request", "body is required"), { status: 400 });
  }

  const proxied = await tryProxyJson(request, `/api/annotations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({ ok: true, id, note: body.note ?? null });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const proxied = await tryProxyResponse(request, `/api/annotations/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  if (proxied) {
    return proxied;
  }

  const removed = deleteAnnotation(userIdFromRequest(request), id);
  if (!removed) {
    return NextResponse.json(errorPayload("not_found", "Annotation not found"), { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
