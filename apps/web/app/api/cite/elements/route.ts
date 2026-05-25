import { NextRequest, NextResponse } from "next/server";
import type { PdfOverlayElement, PdfOverlayResponse } from "../../../../types/citation";

type MaybeElementsPayload = {
  ok?: boolean;
  doi?: string;
  page?: number;
  items?: unknown[];
};

function toElementType(input: unknown): PdfOverlayElement["elementType"] {
  if (input === "figure" || input === "table" || input === "image") {
    return input;
  }
  return "figure";
}

function normalizeElement(item: Record<string, unknown>, doi: string, page: number, index: number): PdfOverlayElement {
  const rect = item.normRect as Record<string, unknown> | undefined;
  const x = typeof rect?.x === "number" ? rect.x : 0.08 + (index % 3) * 0.22;
  const y = typeof rect?.y === "number" ? rect.y : 0.18 + (index % 4) * 0.14;
  const width = typeof rect?.width === "number" ? rect.width : 0.26;
  const height = typeof rect?.height === "number" ? rect.height : 0.13;

  return {
    sentenceId: String(item.sentenceId ?? item.sentence_id ?? `${doi}-${page}-element-${index + 1}`),
    doi: String(item.doi ?? doi),
    page: Number.isFinite(Number(item.page)) ? Number(item.page) : page,
    elementType: toElementType(item.elementType ?? item.element_type),
    elementLabel: String(item.elementLabel ?? item.element_label ?? `Figure ${index + 1}`),
    normRect: {
      x,
      y,
      width,
      height
    }
  };
}

function buildMockElements(doi: string, page: number): PdfOverlayElement[] {
  return [
    {
      sentenceId: `${doi}-p${page}-figure-1`,
      doi,
      page,
      elementType: "figure",
      elementLabel: "Figure 1",
      normRect: { x: 0.12, y: 0.16, width: 0.3, height: 0.18 }
    },
    {
      sentenceId: `${doi}-p${page}-table-1`,
      doi,
      page,
      elementType: "table",
      elementLabel: "Table 1",
      normRect: { x: 0.54, y: 0.45, width: 0.34, height: 0.2 }
    },
    {
      sentenceId: `${doi}-p${page}-image-1`,
      doi,
      page,
      elementType: "image",
      elementLabel: "Image 1",
      normRect: { x: 0.14, y: 0.72, width: 0.27, height: 0.14 }
    }
  ];
}

async function fetchFromUpstream(doi: string, page: number): Promise<PdfOverlayResponse | null> {
  const base = process.env.SCHOLARPULSE_API_BASE_URL;
  if (!base) {
    return null;
  }

  const upstreamUrl = new URL("/api/cite/elements", base);
  upstreamUrl.searchParams.set("doi", doi);
  upstreamUrl.searchParams.set("page", String(page));

  try {
    const response = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as MaybeElementsPayload;
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items = rawItems
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item, index) => normalizeElement(item, doi, page, index));

    return {
      ok: true,
      doi,
      page,
      items
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const doi = request.nextUrl.searchParams.get("doi")?.trim();
  const pageInput = Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageInput) && pageInput > 0 ? pageInput : 1;
  if (!doi) {
    return NextResponse.json(
      {
        ok: false,
        error: "doi query parameter is required"
      },
      { status: 400 }
    );
  }

  const upstreamPayload = await fetchFromUpstream(doi, page);
  if (upstreamPayload) {
    return NextResponse.json(upstreamPayload);
  }

  const payload: PdfOverlayResponse = {
    ok: true,
    doi,
    page,
    items: buildMockElements(doi, page)
  };
  return NextResponse.json(payload);
}
