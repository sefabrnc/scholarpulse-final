import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { addAnnotation, getAnnotations } from "../_lib/memoryStore";
import { errorPayload, tryProxyJson, userIdFromRequest } from "../_lib/upstream";

type AnnotationBody = {
  doi?: string;
  page?: number;
  norm_x?: number;
  norm_y?: number;
  norm_w?: number;
  norm_h?: number;
  color?: string;
  note?: string;
};

export async function GET(request: NextRequest) {
  const doi = request.nextUrl.searchParams.get("doi");
  const suffix = doi ? `?doi=${encodeURIComponent(doi)}` : "";
  const proxied = await tryProxyJson<{ items: unknown[] }>(request, `/api/annotations${suffix}`);
  if (proxied) {
    return NextResponse.json(proxied);
  }

  const userId = userIdFromRequest(request);
  const items = getAnnotations(userId).filter((item) => (doi ? item.doi === doi : true));
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as AnnotationBody | null;
  if (!body?.doi || typeof body.page !== "number") {
    return NextResponse.json(errorPayload("bad_request", "doi and page are required"), { status: 400 });
  }

  const proxied = await tryProxyJson<{ ok?: boolean; item?: unknown }>(request, "/api/annotations", {
    method: "POST",
    body: JSON.stringify(body)
  });
  if (proxied) {
    return NextResponse.json(proxied);
  }

  addAnnotation({
    id: randomUUID(),
    userId: userIdFromRequest(request),
    doi: body.doi,
    page: body.page,
    norm_x: body.norm_x ?? 0,
    norm_y: body.norm_y ?? 0,
    norm_w: body.norm_w ?? 0,
    norm_h: body.norm_h ?? 0,
    color: body.color,
    note: body.note
  });

  return NextResponse.json({ ok: true });
}
