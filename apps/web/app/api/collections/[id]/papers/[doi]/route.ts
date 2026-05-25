import { NextRequest, NextResponse } from "next/server";
import { tryProxyJson } from "../../../../_lib/upstream";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; doi: string }> }
) {
  const { id, doi } = await context.params;
  const proxied = await tryProxyJson(
    request,
    `/api/collections/${encodeURIComponent(id)}/papers/${encodeURIComponent(doi)}`,
    { method: "DELETE" }
  );
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({ ok: true, deleted: { collection_id: id, doi } });
}
