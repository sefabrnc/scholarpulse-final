export type BlockType =
  | "paragraph"
  | "heading"
  | "table"
  | "code"
  | "image"
  | "list"
  | "quote"
  | "note"
  | "composite";

export type Placeholder = {
  id: string;
  createdAt: number;
};

export {
  CITE_CE_THRESHOLD,
  CITE_HIGH_CONFIDENCE_THRESHOLD,
  CITE_LOW_CONFIDENCE_MAX,
  CITE_MEDIUM_CONFIDENCE_MIN
} from "./citeThresholds";

export type CiteNode = {
  id: string;
  source: string;
  sourceRef?: string | null;
  title: string;
  doiNorm?: string | null;
  publicationYear?: number | null;
  venue?: string | null;
  nodeType?: string;
  metadataJson?: string | null;
  authorsText?: string | null;
  topicTerms?: string | null;
  rankSignal?: number | null;
};

export type CiteEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
  weight?: number | null;
  evidenceRef?: string | null;
};

export type VectorPayloadEntry = {
  id: string;
  values: number[];
  metadata?: Record<string, string | number | boolean | null> | null;
};

export type BulkIngestVectors = {
  sentence: VectorPayloadEntry[];
  paper: VectorPayloadEntry[];
};

export type TimelineCard = {
  edgeId: string;
  edgeType: string;
  direction: "inbound" | "outbound";
  relatedNodeId: string;
  title: string;
  publicationYear: number | null;
  venue: string | null;
  doiNorm: string | null;
  authorsText: string | null;
  topicTerms: string | null;
};

export type BulkIngestPayload = {
  nodes: CiteNode[];
  edges: CiteEdge[];
  vectors: BulkIngestVectors;
};

export type SearchResult = {
  nodeId: string;
  title: string;
  authorsText: string | null;
  venue: string | null;
  publicationYear: number | null;
  doiNorm: string | null;
  tldr: string | null;
  rankSignal: number;
  score: number;
};

export type BulkUpsertPaper = {
  nodeId: string;
  source: string;
  sourceRef?: string | null;
  title: string;
  doiNorm?: string | null;
  publicationYear?: number | null;
  venue?: string | null;
  nodeType?: string;
  metadataJson?: string | null;
  authorsText?: string | null;
  topicTerms?: string | null;
  tldr?: string | null;
  rankSignal?: number;
};

export type ResolveResponse = {
  ok?: boolean;
  status?: "resolved" | "pending_ingest" | string;
  input?: string;
  canonical_doi?: string;
  node_id?: string;
  title?: string | null;
  tldr?: string | null;
  pending_id?: string;
  redirect?: {
    path?: string;
    href?: string;
  };
};

export type LibraryImportResponse = {
  ok?: boolean;
  format?: string;
  detected_dois?: number;
  imported_count?: number;
  queued_count?: number;
  imported?: { doi: string; node_id: string }[];
  queued?: { doi: string; pending_id: string }[];
};

export type PaperUploadResponse = {
  ok?: boolean;
  upload_id?: string;
  status?: string;
  byte_size?: number;
  storage_backend?: string;
  expires_at?: number;
  ingest_log_id?: string;
  poll?: {
    path?: string;
    href?: string;
  };
};

export type PaperUploadStatusResponse = {
  ok?: boolean;
  upload_id?: string;
  status?: string;
  byte_size?: number;
  filename?: string | null;
  storage_backend?: string;
  expires_at?: number;
};
