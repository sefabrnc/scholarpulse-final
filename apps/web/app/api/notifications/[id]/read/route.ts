import { NextRequest, NextResponse } from "next/server";
import { tryProxyJson } from "../../../_lib/upstream";

type Params = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: Params) {
  const { id } = await context.params;
  const notificationId = decodeURIComponent(id).trim();
  if (!notificationId) {
    return NextResponse.json({ error: { code: "INVALID_ID", message: "notification id is required" } }, { status: 400 });
  }

  const proxied = await tryProxyJson<Record<string, unknown>>(
    request,
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "PATCH", body: JSON.stringify({}) }
  );
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({ ok: true, id: notificationId, read_at: new Date().toISOString(), mode: "local_stub" });
}
