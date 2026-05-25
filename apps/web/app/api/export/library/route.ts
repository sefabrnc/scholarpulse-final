import { NextRequest, NextResponse } from "next/server";
import { errorPayload, tryProxyJson, tryProxyResponse } from "../../_lib/upstream";

const VALID_FORMATS = new Set(["bibtex", "ris", "json"]);

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format") ?? "json";
  if (!VALID_FORMATS.has(format)) {
    return NextResponse.json(errorPayload("bad_request", "format must be bibtex, ris, or json"), {
      status: 400
    });
  }

  const proxied = await tryProxyResponse(
    request,
    `/api/export/library?format=${encodeURIComponent(format)}`
  );
  if (proxied) {
    return proxied;
  }

  const extension = format === "bibtex" ? "bib" : format;
  const body = format === "json" ? "[]\n" : "";
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": format === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="library.${extension}"`
    }
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { format?: string } | null;
  const format = body?.format ?? "json";
  if (!VALID_FORMATS.has(format)) {
    return NextResponse.json(errorPayload("bad_request", "format must be bibtex, ris, or json"), {
      status: 400
    });
  }

  const proxied = await tryProxyJson(request, `/api/export/library?format=${encodeURIComponent(format)}`);
  if (proxied) {
    return NextResponse.json(proxied);
  }

  return NextResponse.json({ ok: true, format });
}
