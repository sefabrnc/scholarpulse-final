export type UserTier = "free" | "pro";

export type NormRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MarkerKind =
  | "numeric-bracket"
  | "numeric-range"
  | "author-year"
  | "author-bracket";

export type CitationMarker = {
  id: string;
  key: string;
  label: string;
  start: number;
  end: number;
  kind: MarkerKind;
  normRect: NormRect;
};

export type TextSegment = {
  text: string;
  marker?: CitationMarker;
};

export type TimelineItem = {
  edgeId: string;
  relatedNodeId: string;
  title: string;
  publicationYear: number | null;
  venue: string | null;
  doiNorm: string | null;
  direction: "inbound" | "outbound";
  edgeType: string | null;
  relationType?: string | null;
  authorsText: string | null;
  topicTerms: string | null;
  page?: number | null;
  ceScore?: number | null;
  confidenceTier?: string | null;
  intentConfidence?: number | null;
  isInfluential?: boolean;
  refLabel?: string | null;
  normRect?: NormRect | null;
};

export type TimelineResponse = {
  ok: boolean;
  id: string;
  plan: UserTier;
  tierLimit: number;
  limit: number;
  items: TimelineItem[];
  seeds?: string[];
  perSeed?: Record<string, number>;
};

export type PdfElementType = "figure" | "table" | "image";

export type PdfOverlayElement = {
  sentenceId: string;
  doi: string;
  page: number;
  elementType: PdfElementType;
  elementLabel: string;
  normRect: NormRect;
};

export type PdfOverlayResponse = {
  ok: boolean;
  doi: string;
  page: number;
  items: PdfOverlayElement[];
};

export type RenderSnippetRequest = {
  cacheKey: string;
  requestId: string;
  docId: string;
  page: number;
  normRect: NormRect;
  cssWidth: number;
  cssHeight: number;
  scale: number;
  version: string;
  dpr: number;
  pdfData: ArrayBuffer;
};

export type RenderSnippetResult = {
  requestId: string;
  cacheKey: string;
  ok: boolean;
  dataUrl?: string;
  error?: string;
};

export type RenderWorkerMessage =
  | {
      type: "render-snippet";
      payload: RenderSnippetRequest;
    }
  | {
      type: "render-snippet-result";
      payload: RenderSnippetResult;
    };
