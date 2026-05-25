import { Hono } from "hono";
import type { Context } from "hono";
import {
  buildHttpMetricFields,
  buildHttpMetricsSummary,
  createTraceId,
  recordHttpRequestMetric,
  safePathname
} from "./observability";
import {
  decodeBase64Payload,
  detectImportFormat,
  extractDoisFromImport,
  MAX_PDF_UPLOAD_BYTES,
  PDF_UPLOAD_TTL_SECONDS,
  sha256HexFromBytes,
  type ImportFormat
} from "./ingest";
import {
  allowPdfCircuitRequest,
  getPdfCircuitBreakerSnapshot,
  listPdfCircuitBreakerSnapshots,
  recordPdfCircuitFailure,
  recordPdfCircuitSuccess
} from "./pdf-circuit-breaker";

type Env = {
  DB: D1Database;
  UPLOADS_BUCKET?: R2Bucket;
  COLAB_INGEST_TOKEN?: string;
  INTERNAL_API_TOKEN?: string;
  LOG_LEVEL?: string;
  LOG_FORMAT?: string;
  BULK_INGEST_MAX_PAPERS_PER_CHUNK?: string;
  BULK_INGEST_MAX_BODY_BYTES?: string;
  REVALIDATION_DEFAULT_STALE_SECONDS?: string;
  REVALIDATION_CRON_PAGE_LIMIT?: string;
  REVALIDATION_CRON_MAX_PAGES?: string;
  REVALIDATION_CRON_ALGORITHM_VERSION?: string;
  REVALIDATION_CRON_DEFAULT_STATUS?: string;
  REVALIDATION_CRON_DEFAULT_CONFIDENCE_TIER?: string;
  PAPER_VECTORS: VectorizeIndex;
  SENTENCE_VECTORS: VectorizeIndex;
  PAPER_VECTOR_INDEX_NAME?: string;
  SENTENCE_VECTOR_INDEX_NAME?: string;
};

type CiteNode = {
  id: string;
  source: string;
  sourceRef: string | null;
  title: string;
  doiNorm: string | null;
  publicationYear: number | null;
  venue: string | null;
  nodeType: string;
  metadataJson: string | null;
  authorsText: string | null;
  topicTerms: string | null;
  rankSignal: number | null;
};

type CiteEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
  weight: number | null;
  evidenceRef: string | null;
};

type VectorPayloadEntry = {
  id: string;
  values: number[];
  metadata: Record<string, string | number | boolean> | null;
};

type BulkIngestVectors = {
  sentence: VectorPayloadEntry[];
  paper: VectorPayloadEntry[];
};

type BulkIngestPayload = {
  nodes: CiteNode[];
  edges: CiteEdge[];
  vectors: BulkIngestVectors;
  meta?: {
    paperCount: number | null;
    doiAliases?: Record<string, string>;
  };
};

type SearchResult = {
  nodeId: string;
  title: string;
  authorsText: string | null;
  venue: string | null;
  publicationYear: number | null;
  doiNorm: string | null;
  tldr: string | null;
  rankSignal: number;
  score: number;
  influentialCount?: number;
};

type TimelineCard = {
  edgeId: string;
  edgeType: string;
  direction: "outbound" | "inbound";
  relatedNodeId: string;
  title: string;
  publicationYear: number | null;
  venue: string | null;
  doiNorm: string | null;
  authorsText: string | null;
  topicTerms: string | null;
  weight: number | null;
  evidenceRef: string | null;
  confidenceTier: string | null;
  page: number | null;
  normX: number | null;
  normY: number | null;
  normW: number | null;
  normH: number | null;
  evidenceMetadata?: string | null;
  evidenceSourceRef?: string | null;
};

const app = new Hono<{ Bindings: Env }>();
const MAX_SQL_PARAMS = 100;
const MAX_VECTOR_UPSERT_ITEMS = 250;
const DEFAULT_BULK_INGEST_MAX_PAPERS_PER_CHUNK = 50;
const DEFAULT_BULK_INGEST_MAX_BODY_BYTES = 90 * 1024 * 1024;
const ABSOLUTE_MAX_BULK_INGEST_BODY_BYTES = 100 * 1024 * 1024;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const FREE_TIMELINE_LIMIT = 10;
const PRO_TIMELINE_LIMIT = 100;
const RRF_K = 60;
const DOI_PATH_REGEX = /^\/10\.\d{4,9}\/\S+$/i;
const PDF_PROXY_ALLOWLIST = new Set([
  "arxiv.org",
  "doi.org",
  "dx.doi.org",
  "cdnsciencepub.com",
  "link.springer.com",
  "springer.com",
  "nature.com"
]);
const PDF_PROXY_CACHE_TTL_SECONDS = 3600;
const PDF_PROXY_RATE_LIMIT_PER_WINDOW = 6;
const PDF_PROXY_RATE_WINDOW_MS = 60_000;
const PDF_PROXY_DEFAULT_BACKOFF_SECONDS = 30;
const INTERNAL_DEFAULT_PAGE_LIMIT = 100;
const INTERNAL_MAX_PAGE_LIMIT = 1000;
const VECTORIZE_MAX_TOP_K = 50;
const HEARTBEAT_STALE_SECONDS = 30 * 60;
const PAPER_DETAIL_MAX_AUTHORS = 100;
const PAPER_DETAIL_MAX_TOPICS = 50;
const DEFAULT_REVALIDATION_STALE_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_REVALIDATION_CRON_PAGE_LIMIT = 500;
const DEFAULT_REVALIDATION_CRON_MAX_PAGES = 4;
const DEFAULT_REVALIDATION_ALGORITHM_VERSION = "v1-revalidation-cron";
const DEFAULT_REVALIDATION_STATUS = "active";
const DEFAULT_REVALIDATION_CONFIDENCE_TIER = "medium";
const FORBIDDEN_VECTOR_METADATA_KEYS = new Set([
  "text",
  "sentence",
  "sentence_text",
  "content",
  "body",
  "abstract",
  "snippet",
  "raw_text",
  "title",
  "authors",
  "caption"
]);
const ALLOWED_VECTOR_METADATA_KEYS = new Set([
  "doi",
  "page",
  "sentence_id",
  "kind",
  "stage",
  "year",
  "citation_count",
  "doi_prefix"
]);
const PDF_PROXY_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0"
];

const pdfProxyRateBuckets = new Map<string, { windowStartMs: number; count: number }>();
const requestTraceIds = new WeakMap<Request, string>();
let colabHeartbeatState: {
  lastSeenAt: number;
  runId: string | null;
  platform: string | null;
  processed: number | null;
  lastDoi: string | null;
} | null = null;
const LOG_LEVEL_RANK: Record<"debug" | "info" | "warn" | "error", number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

type SearchFilters = {
  yearFrom: number | null;
  yearTo: number | null;
  minCitations: number;
  journal: string | null;
  author: string | null;
  topic: string | null;
  sort: "relevance" | "citations" | "year";
  limit: number;
};

type SearchCandidateRow = {
  nodeId: string;
  title: string;
  authorsText: string | null;
  venue: string | null;
  publicationYear: number | null;
  doiNorm: string | null;
  tldr?: string | null;
  rankSignal: number | null;
  score?: number;
};

type SearchAccumulator = {
  item: SearchResult;
  rrfScore: number;
  ftsRank: number | null;
  vectorRank: number | null;
};

type ApiError = {
  error: {
    code: string;
    message: string;
  };
};
type ErrorStatus = 400 | 401 | 403 | 404 | 413 | 429 | 500 | 502;

type BulkUpsertPaper = {
  nodeId: string;
  source: string;
  sourceRef: string | null;
  title: string;
  doiNorm: string | null;
  publicationYear: number | null;
  venue: string | null;
  nodeType: string;
  metadataJson: string | null;
  authorsText: string | null;
  topicTerms: string | null;
  tldr: string | null;
  rankSignal: number;
};

type BulkUpsertAuthor = {
  nodeId: string;
  authorId: string;
  authorName: string;
  authorOrder: number;
};

type BulkUpsertTopic = {
  nodeId: string;
  topic: string;
  score: number | null;
};

type BulkUpsertPayload = {
  papers: BulkUpsertPaper[];
  authors: BulkUpsertAuthor[];
  topics: BulkUpsertTopic[];
};

type VectorMatch = {
  id: string;
};

type VectorEntry = {
  values: number[];
};

type UserResolution = {
  userId: string;
};

type AnnotationRecord = {
  id: string;
  user_id: string;
  node_id: string;
  page: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  color: string | null;
  payload_json: string | null;
  created_at: number;
  updated_at: number;
};

type SavedSearchRecord = {
  id: string;
  query_hash: string;
  filters_json: string | null;
  created_at: number;
  last_run_at: number | null;
};

type NotificationRecord = {
  id: string;
  channel: string;
  type: string;
  payload_json: string | null;
  created_at: number;
  read_at: number | null;
};

type ExportFormat = "bibtex" | "ris" | "json";

type ExportPaperRecord = {
  nodeId: string;
  doiNorm: string | null;
  title: string;
  authorsText: string | null;
  publicationYear: number | null;
  venue: string | null;
  sourceRef: string | null;
};

type D1ChangeMeta = {
  changes?: number;
};

function jsonError(
  c: Context<{ Bindings: Env }>,
  status: ErrorStatus,
  code: string,
  message: string
) {
  return c.json<ApiError>({ error: { code, message } }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseEvidenceRef(evidenceRef: string | null): {
  ceScore: number | null;
  confidenceTier: string | null;
  intentConfidence: number | null;
} {
  if (!evidenceRef) {
    return { ceScore: null, confidenceTier: null, intentConfidence: null };
  }
  let ceScore: number | null = null;
  let confidenceTier: string | null = null;
  let intentConfidence: number | null = null;
  for (const part of evidenceRef.split(";")) {
    const [key, rawValue] = part.split(":");
    if (!key || !rawValue) {
      continue;
    }
    if (key === "ce") {
      ceScore = toOptionalNumber(rawValue);
    }
    if (key === "tier") {
      confidenceTier = rawValue;
    }
    if (key === "intent") {
      intentConfidence = toOptionalNumber(rawValue);
    }
  }
  return { ceScore, confidenceTier, intentConfidence };
}

function parseEvidenceNodeMetadata(
  metadataJson: string | null,
  sourceRef: string | null
): {
  page: number | null;
  normX: number | null;
  normY: number | null;
  normW: number | null;
  normH: number | null;
} {
  let page: number | null = null;
  let normX: number | null = null;
  let normY: number | null = null;
  let normW: number | null = null;
  let normH: number | null = null;

  if (metadataJson) {
    try {
      const parsed = JSON.parse(metadataJson) as unknown;
      if (isRecord(parsed)) {
        normX = toOptionalNumber(parsed.norm_x ?? parsed.normX);
        normY = toOptionalNumber(parsed.norm_y ?? parsed.normY);
        normW = toOptionalNumber(parsed.norm_w ?? parsed.normW);
        normH = toOptionalNumber(parsed.norm_h ?? parsed.normH);
        page = toOptionalNumber(parsed.page);
      }
    } catch {
      // Ignore malformed metadata_json payloads.
    }
  }

  if (page === null && sourceRef) {
    const match = sourceRef.match(/#p(\d+)/i);
    if (match) {
      const parsedPage = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsedPage) && parsedPage > 0) {
        page = parsedPage;
      }
    }
  }

  return { page, normX, normY, normW, normH };
}

function enrichTimelineItem(row: TimelineCard) {
  const evidence = parseEvidenceRef(row.evidenceRef);
  const metadata = parseEvidenceNodeMetadata(row.evidenceMetadata ?? null, row.evidenceSourceRef ?? null);
  const ceScore = evidence.ceScore ?? row.weight;
  const relationType = row.edgeType;
  const confidenceTier = row.confidenceTier ?? evidence.confidenceTier;
  const relation = relationType.toLowerCase();
  const isInfluential =
    (ceScore ?? 0) >= 0.95 || relation === "supports" || relation === "extends";
  const normX = row.normX ?? metadata.normX;
  const normY = row.normY ?? metadata.normY;
  const normW = row.normW ?? metadata.normW;
  const normH = row.normH ?? metadata.normH;
  const normRect =
    normX !== null && normY !== null && normW !== null && normH !== null
      ? {
          x: normX,
          y: normY,
          width: normW,
          height: normH
        }
      : null;

  return {
    ...row,
    relationType,
    relation_type: relationType,
    edge_type: relationType,
    ceScore,
    ce_score: ceScore,
    confidenceTier,
    confidence_tier: confidenceTier,
    intentConfidence: evidence.intentConfidence,
    intent_confidence: evidence.intentConfidence,
    isInfluential,
    page: row.page ?? metadata.page,
    normRect
  };
}

function sortSearchItems(
  items: SearchResult[],
  sort: SearchFilters["sort"]
): SearchResult[] {
  if (sort === "citations") {
    return [...items].sort((a, b) => {
      if (b.rankSignal !== a.rankSignal) {
        return b.rankSignal - a.rankSignal;
      }
      return b.score - a.score;
    });
  }
  if (sort === "year") {
    return [...items].sort((a, b) => {
      const yearA = a.publicationYear ?? 0;
      const yearB = b.publicationYear ?? 0;
      if (yearB !== yearA) {
        return yearB - yearA;
      }
      return b.score - a.score;
    });
  }
  return items;
}

async function attachInfluentialCounts(
  db: D1Database,
  items: SearchResult[]
): Promise<SearchResult[]> {
  const nodeIds = Array.from(new Set(items.map((item) => item.nodeId).filter(Boolean)));
  if (nodeIds.length === 0) {
    return items;
  }

  const placeholders = nodeIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT
        e.to_node_id AS nodeId,
        COUNT(*) AS influentialCount
      FROM cite_edges e
      WHERE e.to_node_id IN (${placeholders})
        AND e.status = 'active'
        AND (
          COALESCE(e.weight, 0) >= 0.95
          OR LOWER(e.edge_type) IN ('supports', 'extends')
        )
      GROUP BY e.to_node_id`
    )
    .bind(...nodeIds)
    .all<{ nodeId: string; influentialCount: number }>();

  const countByNode = new Map<string, number>();
  for (const row of rows.results ?? []) {
    countByNode.set(row.nodeId, row.influentialCount);
  }

  return items.map((item) => ({
    ...item,
    influentialCount: countByNode.get(item.nodeId) ?? 0
  }));
}

function parseDoiList(raw: string | null | undefined, max = 50): string[] {
  if (!raw) {
    return [];
  }
  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of raw.split(",")) {
    const normalized = normalizeDoiForStorage(part.trim());
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    values.push(normalized);
    if (values.length >= max) {
      break;
    }
  }
  return values;
}

function getIngestTokenFromRequest(c: Context<{ Bindings: Env }>): string | null {
  const headerToken = c.req.header("x-ingest-token")?.trim();
  if (headerToken) {
    return headerToken;
  }
  const authorization = c.req.header("authorization")?.trim();
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token.trim() || null;
}

function requireColabToken(c: Context<{ Bindings: Env }>): ApiError | null {
  const expectedToken = c.env.COLAB_INGEST_TOKEN?.trim() ?? c.env.INTERNAL_API_TOKEN?.trim();
  if (!expectedToken) {
    return {
      error: {
        code: "INGEST_TOKEN_MISSING",
        message: "COLAB_INGEST_TOKEN or INTERNAL_API_TOKEN is not configured"
      }
    };
  }
  const providedToken = getIngestTokenFromRequest(c);
  if (!providedToken || providedToken !== expectedToken) {
    return {
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid ingest token"
      }
    };
  }
  return null;
}

function requireInternalToken(c: Context<{ Bindings: Env }>): ApiError | null {
  const expectedToken = c.env.INTERNAL_API_TOKEN?.trim() ?? c.env.COLAB_INGEST_TOKEN?.trim();
  if (!expectedToken) {
    return {
      error: {
        code: "INTERNAL_TOKEN_MISSING",
        message: "INTERNAL_API_TOKEN or COLAB_INGEST_TOKEN is not configured"
      }
    };
  }
  const providedToken = getIngestTokenFromRequest(c);
  if (!providedToken || providedToken !== expectedToken) {
    return {
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid internal token"
      }
    };
  }
  return null;
}

function resolveTraceId(c: Context<{ Bindings: Env }>): string {
  return requestTraceIds.get(c.req.raw) ?? "unknown";
}

function resolveLogLevel(env: Env): keyof typeof LOG_LEVEL_RANK {
  const rawLevel = env.LOG_LEVEL?.trim().toLowerCase();
  if (rawLevel === "debug" || rawLevel === "info" || rawLevel === "warn" || rawLevel === "error") {
    return rawLevel;
  }
  return "info";
}

function shouldEmitLog(env: Env, level: keyof typeof LOG_LEVEL_RANK): boolean {
  const configured = resolveLogLevel(env);
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[configured];
}

function logStructured(
  c: Context<{ Bindings: Env }>,
  level: keyof typeof LOG_LEVEL_RANK,
  event: string,
  details?: Record<string, unknown>
) {
  if (!shouldEmitLog(c.env, level)) {
    return;
  }
  const payload: Record<string, unknown> = {
    level,
    event,
    trace_id: resolveTraceId(c),
    method: c.req.method,
    path: safePathname(c.req.url),
    ts: new Date().toISOString(),
    ...(details ?? {})
  };
  if ((c.env.LOG_FORMAT?.trim().toLowerCase() ?? "json") === "plain") {
    console.log(`[${payload.level}] ${payload.event} trace=${payload.trace_id}`);
    return;
  }
  console.log(JSON.stringify(payload));
}

function toOptionalStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function getRequestUser(c: Context<{ Bindings: Env }>): UserResolution | null {
  const fromHeader = toOptionalString(c.req.header("x-user-id"));
  const fromQuery = toOptionalString(c.req.query("user_id"));
  const userId = fromHeader ?? fromQuery;
  if (!userId) {
    return null;
  }
  return { userId };
}

function parseBodyNote(payloadJson: string | null): string | null {
  if (!payloadJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(payloadJson);
    if (!isRecord(parsed)) {
      return null;
    }
    return toOptionalString(parsed.note);
  } catch {
    return null;
  }
}

function buildAnnotationPayloadJson(note: string | null): string | null {
  if (!note) {
    return null;
  }
  return JSON.stringify({ note });
}

function parseNormalizedRect(input: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!isRecord(input)) {
    return null;
  }
  const x = toOptionalNumber(input.x ?? input.norm_x);
  const y = toOptionalNumber(input.y ?? input.norm_y);
  const width = toOptionalNumber(input.width ?? input.norm_w);
  const height = toOptionalNumber(input.height ?? input.norm_h);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x > 1 || y > 1 || width > 1 || height > 1) {
    return null;
  }
  return { x, y, width, height };
}

function parseOptionalNormalizedRect(
  input: unknown
): { x: number | null; y: number | null; width: number | null; height: number | null } {
  if (!isRecord(input)) {
    return { x: null, y: null, width: null, height: null };
  }
  const x = toOptionalNumber(input.x ?? input.norm_x);
  const y = toOptionalNumber(input.y ?? input.norm_y);
  const width = toOptionalNumber(input.width ?? input.norm_w);
  const height = toOptionalNumber(input.height ?? input.norm_h);
  const values = [x, y, width, height];
  if (values.some((value) => value !== null && (value < 0 || value > 1))) {
    throw new Error("norm_x, norm_y, norm_w, norm_h must be between 0 and 1");
  }
  if (width !== null && width <= 0) {
    throw new Error("norm_w must be greater than 0");
  }
  if (height !== null && height <= 0) {
    throw new Error("norm_h must be greater than 0");
  }
  return { x, y, width, height };
}

function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function makeId(prefix: string): string {
  const raw = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${raw.slice(0, 24)}`;
}

function normalizeDoiForStorage(rawValue: string): string | null {
  const normalized = normalizeDoi(rawValue);
  return normalized ? normalized.toLowerCase() : null;
}

function makeQueryHash(rawQuery: string): string {
  const normalized = rawQuery.trim().toLowerCase();
  const digest = hashString(`${normalized}:${normalized.length}`).toString(16);
  return digest.padStart(8, "0");
}

async function resolveNodeIdByDoi(c: Context<{ Bindings: Env }>, doiNorm: string): Promise<string | null> {
  const fromSearch = await c.env.DB.prepare(
    `SELECT node_id AS id
    FROM paper_search
    WHERE LOWER(doi_norm) = LOWER(?)
    LIMIT 1`
  )
    .bind(doiNorm)
    .first<{ id: string }>();
  if (fromSearch?.id) {
    return fromSearch.id;
  }

  const fromAlias = await c.env.DB.prepare(
    `SELECT node_id AS id
    FROM doi_aliases
    WHERE LOWER(doi_norm) = LOWER(?) OR LOWER(doi_raw) = LOWER(?)
    LIMIT 1`
  )
    .bind(doiNorm, doiNorm)
    .first<{ id: string }>();
  if (fromAlias?.id) {
    return fromAlias.id;
  }

  const result = await c.env.DB.prepare(
    `SELECT id
    FROM cite_nodes
    WHERE doi_norm = ?
    ORDER BY CASE WHEN node_type = 'paper' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1`
  )
    .bind(doiNorm)
    .first<{ id: string }>();
  return result?.id ?? null;
}

type ResolvedPaperLookup = {
  nodeId: string;
  doiNorm: string | null;
  title: string | null;
  tldr: string | null;
  sourceRef: string | null;
};

async function lookupResolvedPaperByDoi(
  c: Context<{ Bindings: Env }>,
  doi: string
): Promise<ResolvedPaperLookup | null> {
  const fromSearch = await c.env.DB.prepare(
    `SELECT
      ps.node_id AS nodeId,
      ps.doi_norm AS doiNorm,
      ps.title AS title,
      ps.tldr AS tldr,
      cn.source_ref AS sourceRef
    FROM paper_search ps
    LEFT JOIN cite_nodes cn ON cn.id = ps.node_id
    WHERE LOWER(ps.doi_norm) = LOWER(?)
    LIMIT 1`
  )
    .bind(doi)
    .first<ResolvedPaperLookup>();
  if (fromSearch) {
    return fromSearch;
  }

  return c.env.DB.prepare(
    `SELECT
      cn.id AS nodeId,
      cn.doi_norm AS doiNorm,
      COALESCE(ps.title, cn.title) AS title,
      ps.tldr AS tldr,
      cn.source_ref AS sourceRef
    FROM cite_nodes cn
    LEFT JOIN paper_search ps ON ps.node_id = cn.id
    WHERE LOWER(cn.doi_norm) = LOWER(?)
    ORDER BY cn.updated_at DESC
    LIMIT 1`
  )
    .bind(doi)
    .first<ResolvedPaperLookup>();
}

function meanVector(vectors: number[][]): number[] | null {
  if (vectors.length === 0) {
    return null;
  }
  const dimension = vectors[0].length;
  if (dimension === 0) {
    return null;
  }
  const centroid = new Array<number>(dimension).fill(0);
  let usedCount = 0;
  for (const vector of vectors) {
    if (vector.length !== dimension) {
      continue;
    }
    for (let i = 0; i < dimension; i += 1) {
      centroid[i] += vector[i];
    }
    usedCount += 1;
  }
  if (usedCount === 0) {
    return null;
  }
  for (let i = 0; i < dimension; i += 1) {
    centroid[i] /= usedCount;
  }
  return centroid;
}

function parseVectorMatches(payload: unknown): VectorMatch[] {
  if (!isRecord(payload) || !Array.isArray(payload.matches)) {
    return [];
  }
  return payload.matches
    .map((match) => (isRecord(match) ? toOptionalString(match.id) : null))
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id }));
}

function parseVectorEntries(payload: unknown): VectorEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const entries: VectorEntry[] = [];
  for (const entry of payload) {
    if (!isRecord(entry) || !Array.isArray(entry.values) || entry.values.length === 0) {
      continue;
    }
    if (!entry.values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      continue;
    }
    entries.push({ values: entry.values as number[] });
  }
  return entries;
}

function parseBulkUpsertPayload(input: unknown): BulkUpsertPayload {
  if (!isRecord(input)) {
    throw new Error("payload must be an object");
  }

  const papers = Array.isArray(input.papers) ? input.papers : [];
  const authors = Array.isArray(input.authors) ? input.authors : [];
  const topics = Array.isArray(input.topics) ? input.topics : [];

  const normalizedPapers = papers.map((paper: unknown, index: number) => {
    if (!isRecord(paper)) {
      throw new Error(`papers[${index}] must be an object`);
    }
    const nodeId = toOptionalString(paper.nodeId);
    const source = toOptionalString(paper.source);
    const title = toOptionalString(paper.title);
    if (!nodeId || !source || !title) {
      throw new Error(`papers[${index}] requires nodeId, source, and title`);
    }
    return {
      nodeId,
      source,
      sourceRef: toOptionalString(paper.sourceRef),
      title,
      doiNorm: toOptionalString(paper.doiNorm),
      publicationYear: toOptionalNumber(paper.publicationYear),
      venue: toOptionalString(paper.venue),
      nodeType: toOptionalString(paper.nodeType) ?? "paper",
      metadataJson: toOptionalString(paper.metadataJson),
      authorsText: toOptionalString(paper.authorsText),
      topicTerms: toOptionalString(paper.topicTerms),
      tldr: toOptionalString(paper.tldr),
      rankSignal: toOptionalNumber(paper.rankSignal) ?? 0
    } satisfies BulkUpsertPaper;
  });

  const normalizedAuthors = authors.map((author: unknown, index: number) => {
    if (!isRecord(author)) {
      throw new Error(`authors[${index}] must be an object`);
    }
    const nodeId = toOptionalString(author.nodeId);
    const authorId = toOptionalString(author.authorId);
    const authorName = toOptionalString(author.authorName);
    if (!nodeId || !authorId || !authorName) {
      throw new Error(`authors[${index}] requires nodeId, authorId, and authorName`);
    }
    const authorOrder = Math.max(0, Math.trunc(toOptionalNumber(author.authorOrder) ?? 0));
    return { nodeId, authorId, authorName, authorOrder } satisfies BulkUpsertAuthor;
  });

  const normalizedTopics = topics.map((topic: unknown, index: number) => {
    if (!isRecord(topic)) {
      throw new Error(`topics[${index}] must be an object`);
    }
    const nodeId = toOptionalString(topic.nodeId);
    const topicName = toOptionalString(topic.topic);
    if (!nodeId || !topicName) {
      throw new Error(`topics[${index}] requires nodeId and topic`);
    }
    return {
      nodeId,
      topic: topicName,
      score: toOptionalNumber(topic.score)
    } satisfies BulkUpsertTopic;
  });

  if (normalizedPapers.length === 0 && normalizedAuthors.length === 0 && normalizedTopics.length === 0) {
    throw new Error("payload must include at least one item in papers/authors/topics");
  }

  return {
    papers: normalizedPapers,
    authors: normalizedAuthors,
    topics: normalizedTopics
  };
}

async function applyBulkPaperUpsert(
  db: D1Database,
  parsedPayload: BulkUpsertPayload,
  nowSec: number
): Promise<void> {
  const statements: D1PreparedStatement[] = [];

  if (parsedPayload.papers.length > 0) {
    const nodeRows = parsedPayload.papers.map((paper) => [
      paper.nodeId,
      paper.source,
      paper.sourceRef,
      paper.title,
      paper.doiNorm,
      paper.publicationYear,
      paper.venue,
      paper.nodeType,
      paper.metadataJson,
      nowSec
    ]);
    for (const chunk of chunkRows(nodeRows, 10)) {
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      statements.push(
        db.prepare(
          `INSERT INTO cite_nodes (
            id, source, source_ref, title, doi_norm, publication_year,
            venue, node_type, metadata_json, updated_at
          ) VALUES ${placeholders}
          ON CONFLICT(id) DO UPDATE SET
            source = excluded.source,
            source_ref = excluded.source_ref,
            title = excluded.title,
            doi_norm = excluded.doi_norm,
            publication_year = excluded.publication_year,
            venue = excluded.venue,
            node_type = excluded.node_type,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at`
        ).bind(...chunk.flat())
      );
    }

    const searchRows = parsedPayload.papers.map((paper) => [
      paper.nodeId,
      paper.title,
      paper.authorsText,
      paper.venue,
      paper.topicTerms,
      paper.publicationYear,
      paper.doiNorm,
      paper.rankSignal,
      paper.tldr,
      nowSec
    ]);
    for (const chunk of chunkRows(searchRows, 8)) {
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      statements.push(
        db.prepare(
          `INSERT INTO paper_search (
            node_id, title, authors_text, venue, topic_terms,
            publication_year, doi_norm, rank_signal, tldr, updated_at
          ) VALUES ${placeholders}
          ON CONFLICT(node_id) DO UPDATE SET
            title = excluded.title,
            authors_text = excluded.authors_text,
            venue = excluded.venue,
            topic_terms = excluded.topic_terms,
            publication_year = excluded.publication_year,
            doi_norm = excluded.doi_norm,
            rank_signal = excluded.rank_signal,
            tldr = COALESCE(excluded.tldr, paper_search.tldr),
            updated_at = excluded.updated_at`
        ).bind(...chunk.flat())
      );
    }
  }

  if (parsedPayload.authors.length > 0) {
    const authorRows = parsedPayload.authors.map((author) => [
      author.nodeId,
      author.authorId,
      author.authorName,
      author.authorOrder
    ]);
    for (const chunk of chunkRows(authorRows, 4)) {
      const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
      statements.push(
        db.prepare(
          `INSERT INTO paper_authors (
            node_id, author_id, author_name, author_order
          ) VALUES ${placeholders}
          ON CONFLICT(node_id, author_id) DO UPDATE SET
            author_name = excluded.author_name,
            author_order = excluded.author_order`
        ).bind(...chunk.flat())
      );
    }
  }

  if (parsedPayload.topics.length > 0) {
    const topicRows = parsedPayload.topics.map((topic) => [
      topic.nodeId,
      topic.topic,
      topic.score
    ]);
    for (const chunk of chunkRows(topicRows, 3)) {
      const placeholders = chunk.map(() => "(?, ?, ?)").join(", ");
      statements.push(
        db.prepare(
          `INSERT INTO paper_topics (
            node_id, topic, score
          ) VALUES ${placeholders}
          ON CONFLICT(node_id, topic) DO UPDATE SET
            score = excluded.score`
        ).bind(...chunk.flat())
      );
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

function normalizeNode(input: unknown, index: number): CiteNode {
  if (!isRecord(input)) {
    throw new Error(`nodes[${index}] must be an object`);
  }
  const id = toOptionalString(input.id);
  const source = toOptionalString(input.source);
  const title = toOptionalString(input.title);
  if (!id || !source || !title) {
    throw new Error(`nodes[${index}] requires id, source, and title`);
  }
  const publicationYear = toOptionalNumber(input.publicationYear);
  return {
    id,
    source,
    sourceRef: toOptionalString(input.sourceRef),
    title,
    doiNorm: toOptionalString(input.doiNorm),
    publicationYear: publicationYear !== null ? Math.trunc(publicationYear) : null,
    venue: toOptionalString(input.venue),
    nodeType: toOptionalString(input.nodeType) ?? "paper",
    metadataJson: toOptionalString(input.metadataJson),
    authorsText: toOptionalString(input.authorsText),
    topicTerms: toOptionalString(input.topicTerms),
    rankSignal: toOptionalNumber(input.rankSignal)
  };
}

function normalizeEdge(input: unknown, index: number): CiteEdge {
  if (!isRecord(input)) {
    throw new Error(`edges[${index}] must be an object`);
  }
  const id = toOptionalString(input.id);
  const fromNodeId = toOptionalString(input.fromNodeId);
  const toNodeId = toOptionalString(input.toNodeId);
  const edgeType = toOptionalString(input.edgeType);
  if (!id || !fromNodeId || !toNodeId || !edgeType) {
    throw new Error(
      `edges[${index}] requires id, fromNodeId, toNodeId, and edgeType`
    );
  }
  return {
    id,
    fromNodeId,
    toNodeId,
    edgeType,
    weight: toOptionalNumber(input.weight),
    evidenceRef: toOptionalString(input.evidenceRef)
  };
}

function normalizeVectorMetadata(
  input: unknown,
  group: "sentence" | "paper"
): Record<string, string | number | boolean> | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.trim().toLowerCase();
    if (FORBIDDEN_VECTOR_METADATA_KEYS.has(normalizedKey)) {
      throw new Error(`vectors.${group} metadata forbids key: ${key}`);
    }
    if (!ALLOWED_VECTOR_METADATA_KEYS.has(normalizedKey)) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      metadata[normalizedKey] = value;
    }
  }
  if (!metadata.doi) {
    throw new Error(`vectors.${group} metadata requires doi`);
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function normalizeVectorEntry(input: unknown, index: number, group: string): VectorPayloadEntry {
  if (!isRecord(input)) {
    throw new Error(`vectors.${group}[${index}] must be an object`);
  }
  const id = toOptionalString(input.id);
  if (!id) {
    throw new Error(`vectors.${group}[${index}] requires id`);
  }
  if (!Array.isArray(input.values) || input.values.length === 0) {
    throw new Error(`vectors.${group}[${index}] requires non-empty values[]`);
  }
  const values = input.values.map((value, valueIndex) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`vectors.${group}[${index}].values[${valueIndex}] must be finite number`);
    }
    return value;
  });
  return {
    id,
    values,
    metadata: normalizeVectorMetadata(input.metadata, group as "sentence" | "paper") ?? null
  };
}

function normalizeVectors(input: unknown): BulkIngestVectors {
  if (!isRecord(input)) {
    throw new Error("payload requires vectors object");
  }
  if (!Array.isArray(input.sentence) || !Array.isArray(input.paper)) {
    throw new Error("vectors requires sentence[] and paper[] arrays");
  }
  return {
    sentence: input.sentence.map((entry: unknown, idx: number) =>
      normalizeVectorEntry(entry, idx, "sentence")
    ),
    paper: input.paper.map((entry: unknown, idx: number) => normalizeVectorEntry(entry, idx, "paper"))
  };
}

function parseBulkPayload(input: unknown): BulkIngestPayload {
  if (!isRecord(input)) {
    throw new Error("payload must be an object");
  }
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges) || !isRecord(input.vectors)) {
    throw new Error("payload requires nodes[], edges[], and vectors");
  }
  const nodes = input.nodes.map((node: unknown, idx: number) => normalizeNode(node, idx));
  const edges = input.edges.map((edge: unknown, idx: number) => normalizeEdge(edge, idx));
  const vectors = normalizeVectors(input.vectors);
  let paperCount: number | null = null;
  let doiAliases: Record<string, string> | undefined;
  if (isRecord(input.meta)) {
    const rawPaperCount = toOptionalNumber(input.meta.paperCount ?? input.meta.paper_count);
    if (rawPaperCount !== null && Number.isFinite(rawPaperCount) && rawPaperCount > 0) {
      paperCount = Math.trunc(rawPaperCount);
    }
    const rawAliases = input.meta.doi_aliases ?? input.meta.doiAliases;
    if (isRecord(rawAliases)) {
      doiAliases = {};
      for (const [alias, canonical] of Object.entries(rawAliases)) {
        const aliasNorm = normalizeDoiForStorage(alias);
        const canonicalNorm = normalizeDoiForStorage(String(canonical));
        if (aliasNorm && canonicalNorm && aliasNorm !== canonicalNorm) {
          doiAliases[aliasNorm] = canonicalNorm;
        }
      }
      if (Object.keys(doiAliases).length === 0) {
        doiAliases = undefined;
      }
    }
  }
  return { nodes, edges, vectors, meta: { paperCount, doiAliases } };
}

function countPapersInChunk(payload: BulkIngestPayload): number {
  const explicitPaperCount = payload.meta?.paperCount;
  if (typeof explicitPaperCount === "number" && Number.isFinite(explicitPaperCount) && explicitPaperCount > 0) {
    return Math.trunc(explicitPaperCount);
  }
  const doiSet = new Set<string>();
  for (const node of payload.nodes) {
    if (node.doiNorm) {
      doiSet.add(node.doiNorm.toLowerCase());
    }
  }
  if (doiSet.size > 0) {
    return doiSet.size;
  }
  return payload.nodes.length;
}

function chunkRows<T>(rows: T[], columnsPerRow: number): T[][] {
  const chunkSize = Math.max(1, Math.floor(MAX_SQL_PARAMS / columnsPerRow));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks;
}

function chunkVectorRows<T>(rows: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += MAX_VECTOR_UPSERT_ITEMS) {
    chunks.push(rows.slice(i, i + MAX_VECTOR_UPSERT_ITEMS));
  }
  return chunks;
}

function toVectorizePayload(entries: VectorPayloadEntry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    values: entry.values,
    metadata: entry.metadata ?? undefined
  }));
}

function vectorUpsertHookPlaceholder(
  _groupName: "sentence" | "paper",
  _indexName: string,
  _count: number
) {
  // Reserved for future ingest telemetry hooks.
}

async function upsertVectorGroup(
  index: VectorizeIndex,
  entries: VectorPayloadEntry[],
  indexName: string,
  groupName: "sentence" | "paper"
) {
  if (entries.length === 0) {
    return;
  }
  for (const chunk of chunkVectorRows(entries)) {
    await index.upsert(toVectorizePayload(chunk));
  }
  vectorUpsertHookPlaceholder(groupName, indexName, entries.length);
}

function parsePositiveInt(
  rawValue: string | undefined,
  defaultValue: number,
  maxValue: number
) {
  if (!rawValue) {
    return defaultValue;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return Math.min(parsed, maxValue);
}

function parseOptionalIntegerParam(rawValue: string | undefined): number | null {
  if (!rawValue) {
    return null;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseEnvPositiveInt(rawValue: string | undefined, fallback: number, maxValue: number): number {
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, maxValue);
}

function splitByFixedSize<T>(rows: T[], maxPerChunk: number): T[][] {
  const size = Math.max(1, Math.trunc(maxPerChunk));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

class RequestPolicyError extends Error {
  status: ErrorStatus;
  code: string;

  constructor(status: ErrorStatus, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function parseBulkIngestBodyWithGuards(
  c: Context<{ Bindings: Env }>
): Promise<{
  payload: BulkIngestPayload;
  rawBytes: number;
  payloadHash: string;
  maxPapersPerChunk: number;
  papersInChunk: number;
}> {
  const maxBodyBytes = parseEnvPositiveInt(
    c.env.BULK_INGEST_MAX_BODY_BYTES,
    DEFAULT_BULK_INGEST_MAX_BODY_BYTES,
    ABSOLUTE_MAX_BULK_INGEST_BODY_BYTES
  );
  const maxPapersPerChunk = parseEnvPositiveInt(
    c.env.BULK_INGEST_MAX_PAPERS_PER_CHUNK,
    DEFAULT_BULK_INGEST_MAX_PAPERS_PER_CHUNK,
    500
  );

  const contentLengthHeader = c.req.header("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      throw new RequestPolicyError(
        413,
        "PAYLOAD_TOO_LARGE",
        `payload exceeds configured limit (${contentLength} > ${maxBodyBytes} bytes)`
      );
    }
  }

  const rawBody = await c.req.raw.clone().text();
  const rawBytes = new TextEncoder().encode(rawBody).length;
  if (rawBytes === 0) {
    throw new RequestPolicyError(400, "INVALID_PAYLOAD", "request body must not be empty");
  }
  if (rawBytes > maxBodyBytes) {
    throw new RequestPolicyError(
      413,
      "PAYLOAD_TOO_LARGE",
      `payload exceeds configured limit (${rawBytes} > ${maxBodyBytes} bytes)`
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new RequestPolicyError(400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }

  const payload = parseBulkPayload(body);
  const papersInChunk = countPapersInChunk(payload);
  if (papersInChunk > maxPapersPerChunk) {
    const expectedChunks = splitByFixedSize(new Array(papersInChunk).fill(0), maxPapersPerChunk).length;
    throw new RequestPolicyError(
      400,
      "CHUNK_POLICY_VIOLATION",
      `chunk-size policy exceeded: ${papersInChunk} papers > ${maxPapersPerChunk}. Split into at least ${expectedChunks} chunk(s).`
    );
  }

  return {
    payload,
    rawBytes,
    payloadHash: await sha256Hex(rawBody),
    maxPapersPerChunk,
    papersInChunk
  };
}

function normalizeSearchCandidateRow(row: SearchCandidateRow): SearchResult {
  return {
    nodeId: row.nodeId,
    title: row.title,
    authorsText: row.authorsText ?? null,
    venue: row.venue ?? null,
    publicationYear: row.publicationYear ?? null,
    doiNorm: row.doiNorm ?? null,
    tldr: row.tldr ?? null,
    rankSignal: row.rankSignal ?? 0,
    score: row.score ?? 0
  };
}

function parseSearchFilters(c: Context<{ Bindings: Env }>): SearchFilters | string {
  const limit = parsePositiveInt(c.req.query("limit"), DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
  const yearFrom = parseOptionalIntegerParam(c.req.query("year_from"));
  const yearTo = parseOptionalIntegerParam(c.req.query("year_to"));
  if (c.req.query("year_from") && yearFrom === null) {
    return "year_from must be a valid integer";
  }
  if (c.req.query("year_to") && yearTo === null) {
    return "year_to must be a valid integer";
  }
  if (yearFrom !== null && (yearFrom < 1500 || yearFrom > 2500)) {
    return "year_from is out of allowed range";
  }
  if (yearTo !== null && (yearTo < 1500 || yearTo > 2500)) {
    return "year_to is out of allowed range";
  }
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    return "year_from must be less than or equal to year_to";
  }

  const minCitationsRaw = c.req.query("min_citations");
  const parsedMinCitations = parseOptionalIntegerParam(minCitationsRaw);
  if (minCitationsRaw && parsedMinCitations === null) {
    return "min_citations must be a valid integer";
  }
  const minCitations = Math.max(0, parsedMinCitations ?? 0);

  const sortInput = (c.req.query("sort") ?? "relevance").trim().toLowerCase();
  const sort =
    sortInput === "citations" || sortInput === "year" ? sortInput : "relevance";

  return {
    yearFrom,
    yearTo,
    minCitations,
    journal: toOptionalString(c.req.query("journal")),
    author: toOptionalString(c.req.query("author")),
    topic: toOptionalString(c.req.query("topic")),
    sort,
    limit
  };
}

function buildSearchFilterClauses(
  filters: Omit<SearchFilters, "limit" | "sort">,
  alias: string
): { clauses: string[]; binds: (string | number)[] } {
  const clauses: string[] = [];
  const binds: (string | number)[] = [];
  if (filters.yearFrom !== null) {
    clauses.push(`${alias}.publication_year >= ?`);
    binds.push(filters.yearFrom);
  }
  if (filters.yearTo !== null) {
    clauses.push(`${alias}.publication_year <= ?`);
    binds.push(filters.yearTo);
  }
  if (filters.minCitations > 0) {
    clauses.push(`COALESCE(${alias}.rank_signal, 0) >= ?`);
    binds.push(filters.minCitations);
  }
  if (filters.journal) {
    clauses.push(`LOWER(COALESCE(${alias}.venue, '')) = LOWER(?)`);
    binds.push(filters.journal);
  }
  if (filters.author) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM paper_authors pa
        WHERE pa.node_id = ${alias}.node_id
          AND LOWER(pa.author_name) LIKE LOWER(?)
        LIMIT 1
      )`
    );
    binds.push(`%${filters.author}%`);
  }
  if (filters.topic) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM paper_topics pt
        WHERE pt.node_id = ${alias}.node_id
          AND LOWER(pt.topic) LIKE LOWER(?)
        LIMIT 1
      )`
    );
    binds.push(`%${filters.topic}%`);
  }
  return { clauses, binds };
}

function toFtsQuery(rawQuery: string) {
  return rawQuery
    .trim()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .map((token) => `"${token.replace(/"/g, "")}"`)
    .join(" AND ");
}

function parseEmbeddingVector(rawVector: string | undefined): number[] | null {
  if (!rawVector) {
    return null;
  }
  const tokens = rawVector.split(",").map((token) => token.trim()).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  const values: number[] = [];
  for (const token of tokens) {
    const parsed = Number.parseFloat(token);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    values.push(parsed);
  }
  return values.length > 0 ? values : null;
}

function extractEmbeddingFromAiResponse(result: unknown): number[] | null {
  if (!isRecord(result)) {
    return null;
  }
  const asAny = result as Record<string, unknown>;
  if (Array.isArray(asAny.data) && asAny.data.length > 0) {
    const first = asAny.data[0];
    if (Array.isArray(first)) {
      return first.every((v) => typeof v === "number") ? (first as number[]) : null;
    }
    if (isRecord(first) && Array.isArray(first.embedding)) {
      return first.embedding.every((v) => typeof v === "number")
        ? (first.embedding as number[])
        : null;
    }
  }
  if (Array.isArray(asAny.embedding)) {
    return asAny.embedding.every((v) => typeof v === "number")
      ? (asAny.embedding as number[])
      : null;
  }
  return null;
}

async function getQueryEmbedding(
  c: Context<{ Bindings: Env }>,
  query: string,
  rawVector: string | undefined
): Promise<number[] | null> {
  const parsedVector = parseEmbeddingVector(rawVector);
  if (rawVector && !parsedVector) {
    throw new Error("query_vector must be a comma-separated list of numbers");
  }
  if (parsedVector) {
    return parsedVector;
  }
  const aiBinding = (c.env as Env & { AI?: { run: (model: string, input: unknown) => Promise<unknown> } })
    .AI;
  if (!aiBinding) {
    return null;
  }
  try {
    const aiResult = await aiBinding.run("@cf/baai/bge-base-en-v1.5", { text: [query] });
    return extractEmbeddingFromAiResponse(aiResult);
  } catch {
    return null;
  }
}

function addRrfScores(
  accumulator: Map<string, SearchAccumulator>,
  rows: SearchResult[],
  source: "fts" | "vector"
) {
  for (let index = 0; index < rows.length; index += 1) {
    const rank = index + 1;
    const row = rows[index];
    const existing = accumulator.get(row.nodeId);
    const increment = 1 / (RRF_K + rank);
    if (!existing) {
      accumulator.set(row.nodeId, {
        item: row,
        rrfScore: increment,
        ftsRank: source === "fts" ? rank : null,
        vectorRank: source === "vector" ? rank : null
      });
      continue;
    }
    existing.rrfScore += increment;
    if (source === "fts" && existing.ftsRank === null) {
      existing.ftsRank = rank;
    }
    if (source === "vector" && existing.vectorRank === null) {
      existing.vectorRank = rank;
    }
  }
}

function hasAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  for (const allowed of PDF_PROXY_ALLOWLIST) {
    if (host === allowed || host.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

function normalizeDoi(rawValue: string): string | null {
  const decoded = decodeURIComponent(rawValue).trim().toLowerCase();
  const withoutPrefix = decoded
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^\//, "");
  if (!withoutPrefix || !/^10\.\d{4,9}\/\S+$/.test(withoutPrefix)) {
    return null;
  }
  return withoutPrefix;
}

function normalizeArxivId(rawValue: string): string | null {
  const decoded = decodeURIComponent(rawValue).trim().toLowerCase();
  const withoutPrefix = decoded
    .replace(/^arxiv:\s*/i, "")
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
    .replace(/^https?:\/\/arxiv\.org\/pdf\//i, "")
    .replace(/\.pdf$/i, "")
    .replace(/\/+$/, "");
  if (!withoutPrefix) {
    return null;
  }
  const modernId = /^\d{4}\.\d{4,5}(?:v\d+)?$/i;
  const legacyId = /^[a-z\-]+(?:\.[a-z\-]+)?\/\d{7}(?:v\d+)?$/i;
  if (!modernId.test(withoutPrefix) && !legacyId.test(withoutPrefix)) {
    return null;
  }
  return withoutPrefix;
}

function parseResolveInput(rawId: string): { kind: "doi" | "arxiv" | "url" | "unknown"; doi: string | null; arxivId: string | null } {
  const trimmed = rawId.trim();
  if (!trimmed) {
    return { kind: "unknown", doi: null, arxivId: null };
  }
  const doi = normalizeDoi(trimmed);
  if (doi) {
    return { kind: "doi", doi, arxivId: null };
  }
  const arxivId = normalizeArxivId(trimmed);
  if (arxivId) {
    return { kind: "arxiv", doi: null, arxivId };
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host === "doi.org" || host === "dx.doi.org") {
      const parsedDoi = normalizeDoi(parsed.pathname);
      return { kind: "url", doi: parsedDoi, arxivId: null };
    }
    if (host === "arxiv.org" || host.endsWith(".arxiv.org")) {
      const parsedArxivId = normalizeArxivId(parsed.toString());
      return { kind: "url", doi: null, arxivId: parsedArxivId };
    }
    return { kind: "url", doi: null, arxivId: null };
  } catch {
    return { kind: "unknown", doi: null, arxivId: null };
  }
}

function parseExportFormat(rawFormat: string | undefined): ExportFormat | null {
  const normalized = (rawFormat ?? "").trim().toLowerCase();
  if (normalized === "bibtex" || normalized === "ris" || normalized === "json") {
    return normalized;
  }
  return null;
}

function parseAuthorsList(authorsText: string | null): string[] {
  const raw = toOptionalString(authorsText);
  if (!raw) {
    return [];
  }
  const separator = raw.includes(";") ? ";" : raw.includes(" and ") ? " and " : ",";
  return raw
    .split(separator)
    .map((author) => author.trim())
    .filter((author) => author.length > 0);
}

function escapeBibtexValue(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function buildBibtexKey(item: ExportPaperRecord, index: number): string {
  const firstAuthor = parseAuthorsList(item.authorsText)[0] ?? "unknown";
  const authorToken = firstAuthor.split(/\s+/).slice(-1)[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "unknown";
  const yearToken = item.publicationYear ? String(item.publicationYear) : "nodate";
  return `${authorToken}${yearToken}${index + 1}`;
}

function formatBibtexEntry(item: ExportPaperRecord, index: number): string {
  const key = buildBibtexKey(item, index);
  const lines = [
    `@article{${key},`,
    `  title = {${escapeBibtexValue(item.title)}},`
  ];
  const authors = parseAuthorsList(item.authorsText);
  if (authors.length > 0) {
    lines.push(`  author = {${authors.map(escapeBibtexValue).join(" and ")}},`);
  }
  if (item.publicationYear) {
    lines.push(`  year = {${item.publicationYear}},`);
  }
  if (item.venue) {
    lines.push(`  journal = {${escapeBibtexValue(item.venue)}},`);
  }
  if (item.doiNorm) {
    lines.push(`  doi = {${item.doiNorm}},`);
  }
  if (item.sourceRef) {
    lines.push(`  url = {${escapeBibtexValue(item.sourceRef)}}`);
  } else {
    const lastLine = lines.pop();
    if (lastLine) {
      lines.push(lastLine.replace(/,$/, ""));
    }
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function formatRisEntry(item: ExportPaperRecord): string {
  const lines = [
    "TY  - JOUR",
    `TI  - ${item.title}`
  ];
  for (const author of parseAuthorsList(item.authorsText)) {
    lines.push(`AU  - ${author}`);
  }
  if (item.publicationYear) {
    lines.push(`PY  - ${item.publicationYear}`);
  }
  if (item.venue) {
    lines.push(`JO  - ${item.venue}`);
  }
  if (item.doiNorm) {
    lines.push(`DO  - ${item.doiNorm}`);
  }
  if (item.sourceRef) {
    lines.push(`UR  - ${item.sourceRef}`);
  }
  lines.push("ER  -", "");
  return `${lines.join("\n")}\n`;
}

function buildExportStream(format: ExportFormat, items: ExportPaperRecord[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (format === "json") {
        controller.enqueue(encoder.encode("[\n"));
        items.forEach((item, index) => {
          const payload = {
            node_id: item.nodeId,
            doi: item.doiNorm,
            title: item.title,
            authors: parseAuthorsList(item.authorsText),
            year: item.publicationYear,
            venue: item.venue,
            source_ref: item.sourceRef
          };
          const line = `${JSON.stringify(payload)}${index < items.length - 1 ? "," : ""}\n`;
          controller.enqueue(encoder.encode(line));
        });
        controller.enqueue(encoder.encode("]\n"));
        controller.close();
        return;
      }
      items.forEach((item, index) => {
        const chunk = format === "bibtex"
          ? formatBibtexEntry(item, index)
          : formatRisEntry(item);
        controller.enqueue(encoder.encode(chunk));
      });
      controller.close();
    }
  });
}

function createExportResponse(
  format: ExportFormat,
  filenameBase: string,
  items: ExportPaperRecord[],
  meta: Record<string, unknown>
): Response {
  const extension = format === "bibtex" ? "bib" : format === "ris" ? "ris" : "json";
  const contentType = format === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
  const body = buildExportStream(format, items);
  const headers = new Headers({
    "content-type": contentType,
    "content-disposition": `attachment; filename="${filenameBase}.${extension}"`,
    "cache-control": "no-store"
  });
  headers.set("x-export-count", String(items.length));
  headers.set("x-export-format", format);
  if (meta.scope && typeof meta.scope === "string") {
    headers.set("x-export-scope", meta.scope);
  }
  return new Response(body, {
    status: 200,
    headers
  });
}

function normalizePdfTarget(rawUrl: string | undefined, rawDoi: string | undefined): URL | null {
  if (rawDoi) {
    const normalizedDoi = normalizeDoi(rawDoi);
    if (!normalizedDoi) {
      return null;
    }
    return new URL(`https://doi.org/${normalizedDoi}`);
  }
  if (!rawUrl) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") {
    return null;
  }
  parsed.hash = "";

  const host = parsed.hostname.toLowerCase();
  if (host === "doi.org" || host === "dx.doi.org") {
    const normalizedDoi = normalizeDoi(parsed.pathname);
    if (!normalizedDoi) {
      return null;
    }
    return new URL(`https://doi.org/${normalizedDoi}`);
  }
  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) {
    if (parsed.pathname.startsWith("/abs/")) {
      const arxivId = parsed.pathname.slice("/abs/".length).replace(/\/+$/, "");
      parsed.pathname = `/pdf/${arxivId}.pdf`;
      parsed.search = "";
    } else if (parsed.pathname.startsWith("/pdf/") && !parsed.pathname.endsWith(".pdf")) {
      parsed.pathname = `${parsed.pathname}.pdf`;
    }
  }
  return parsed;
}

function isAllowedPdfUrl(url: URL) {
  if (url.protocol !== "https:") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (!hasAllowedHost(host)) {
    return false;
  }
  if (host === "doi.org" || host === "dx.doi.org") {
    return DOI_PATH_REGEX.test(url.pathname);
  }
  return url.pathname.toLowerCase().endsWith(".pdf");
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickRotatingUserAgent(cacheKey: string): string {
  const nowBucket = Math.floor(Date.now() / PDF_PROXY_RATE_WINDOW_MS);
  const index = hashString(`${cacheKey}:${nowBucket}`) % PDF_PROXY_USER_AGENTS.length;
  return PDF_PROXY_USER_AGENTS[index];
}

function checkPdfProxyRateLimit(key: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const now = Date.now();
  const existing = pdfProxyRateBuckets.get(key);
  if (!existing || now - existing.windowStartMs >= PDF_PROXY_RATE_WINDOW_MS) {
    pdfProxyRateBuckets.set(key, { windowStartMs: now, count: 1 });
    return { allowed: true };
  }
  if (existing.count >= PDF_PROXY_RATE_LIMIT_PER_WINDOW) {
    const retryAfterMs = existing.windowStartMs + PDF_PROXY_RATE_WINDOW_MS - now;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  existing.count += 1;
  pdfProxyRateBuckets.set(key, existing);
  return { allowed: true };
}

async function runVectorUpsertHook(
  c: Context<{ Bindings: Env }>,
  vectors: BulkIngestVectors
) {
  const sentenceIndexName = c.env.SENTENCE_VECTOR_INDEX_NAME?.trim();
  const paperIndexName = c.env.PAPER_VECTOR_INDEX_NAME?.trim();
  if (!sentenceIndexName || !paperIndexName) {
    throw new Error("Vector index names are not configured");
  }

  if (!c.env.SENTENCE_VECTORS || !c.env.PAPER_VECTORS) {
    throw new Error("Vectorize bindings are missing");
  }

  await upsertVectorGroup(c.env.SENTENCE_VECTORS, vectors.sentence, sentenceIndexName, "sentence");
  await upsertVectorGroup(c.env.PAPER_VECTORS, vectors.paper, paperIndexName, "paper");
}

async function writeBulkIngestDlqRecord(
  c: Context<{ Bindings: Env }>,
  input: {
    stage: string;
    errorCode: string;
    message: string;
    payloadHash: string | null;
    payloadBytes: number | null;
    paperCount: number | null;
    batchRef: string;
  }
) {
  const now = nowUnixSeconds();
  try {
    await c.env.DB.prepare(
      `INSERT INTO ingest_dlq (
        id, batch_ref, stage, error_code, error_message,
        payload_hash, payload_bytes, paper_count, retryable, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        makeId("dlq"),
        input.batchRef,
        input.stage,
        input.errorCode,
        input.message.slice(0, 1000),
        input.payloadHash,
        input.payloadBytes,
        input.paperCount,
        1,
        "queued",
        now
      )
      .run();
  } catch (error) {
    const dlqError = error instanceof Error ? error.message : "Unknown DLQ persistence error";
    logStructured(c, "error", "ingest.dlq_persist.failed", {
      stage: input.stage,
      error_message: dlqError
    });
  }
}

async function upsertDoiAliasesFromBulkIngest(
  c: Context<{ Bindings: Env }>,
  payload: BulkIngestPayload
): Promise<number> {
  const aliasMap = payload.meta?.doiAliases;
  if (!aliasMap || Object.keys(aliasMap).length === 0) {
    return 0;
  }

  const nodeIdByDoi = new Map<string, string>();
  for (const node of payload.nodes) {
    if (node.doiNorm && node.id) {
      nodeIdByDoi.set(node.doiNorm.toLowerCase(), node.id);
    }
  }

  const statements: D1PreparedStatement[] = [];
  for (const [aliasDoi, canonicalDoi] of Object.entries(aliasMap)) {
    let nodeId = nodeIdByDoi.get(canonicalDoi.toLowerCase()) ?? null;
    if (!nodeId) {
      nodeId = await resolveNodeIdByDoi(c, canonicalDoi);
    }
    if (!nodeId) {
      continue;
    }
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO doi_aliases (doi_norm, doi_raw, node_id, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(doi_norm, doi_raw) DO UPDATE SET node_id = excluded.node_id`
      ).bind(canonicalDoi, aliasDoi, nodeId, nowUnixSeconds())
    );
  }

  if (statements.length === 0) {
    return 0;
  }
  await c.env.DB.batch(statements);
  return statements.length;
}

type EdgeRevalidateUpdate = {
  id: string;
  status: string | null;
  algorithmVersion: string | null;
  confidenceTier: string | null;
  edgeType: string | null;
  weight: number | null;
  lastValidatedAt: number | null;
};

function normalizeEdgeRevalidateUpdate(input: unknown, index: number): EdgeRevalidateUpdate {
  if (!isRecord(input)) {
    throw new Error(`updates[${index}] must be an object`);
  }
  const id = toOptionalString(input.id);
  if (!id) {
    throw new Error(`updates[${index}] requires id`);
  }
  const update = {
    id,
    status: toOptionalString(input.status),
    algorithmVersion: toOptionalString(input.algorithmVersion ?? input.algorithm_version),
    confidenceTier: toOptionalString(input.confidenceTier ?? input.confidence_tier),
    edgeType: toOptionalString(input.edgeType ?? input.edge_type),
    weight: toOptionalNumber(input.weight),
    lastValidatedAt: toOptionalNumber(input.lastValidatedAt ?? input.last_validated_at)
  };
  if (
    update.status === null &&
    update.algorithmVersion === null &&
    update.confidenceTier === null &&
    update.edgeType === null &&
    update.weight === null &&
    update.lastValidatedAt === null
  ) {
    throw new Error(`updates[${index}] must include at least one mutable field`);
  }
  return update;
}

type RevalidationQueryOptions = {
  cursor: string | null;
  limit: number;
  status: string | null;
  confidenceTier: string | null;
  staleBeforeTs: number | null;
};

type RevalidationEdgeRow = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
  weight: number | null;
  evidence_ref: string | null;
  status: string | null;
  algorithm_version: string | null;
  confidence_tier: string | null;
  last_validated_at: number | null;
  created_at: number;
  source_doi: string | null;
  source_title: string;
  target_doi: string | null;
  target_title: string;
};

async function fetchEdgesForRevalidation(
  db: D1Database,
  options: RevalidationQueryOptions
): Promise<{ items: RevalidationEdgeRow[]; nextCursor: string | null }> {
  const result = await db
    .prepare(
      `SELECT
        e.id,
        e.from_node_id,
        e.to_node_id,
        e.edge_type,
        e.weight,
        e.evidence_ref,
        e.status,
        e.algorithm_version,
        e.confidence_tier,
        e.last_validated_at,
        e.created_at,
        src.doi_norm AS source_doi,
        src.title AS source_title,
        dst.doi_norm AS target_doi,
        dst.title AS target_title
      FROM cite_edges e
      LEFT JOIN cite_nodes src ON src.id = e.from_node_id
      LEFT JOIN cite_nodes dst ON dst.id = e.to_node_id
      WHERE (? IS NULL OR e.id > ?)
        AND (? IS NULL OR e.status = ?)
        AND (? IS NULL OR e.confidence_tier = ?)
        AND (? IS NULL OR COALESCE(e.last_validated_at, 0) <= ?)
      ORDER BY e.id
      LIMIT ?`
    )
    .bind(
      options.cursor,
      options.cursor,
      options.status,
      options.status,
      options.confidenceTier,
      options.confidenceTier,
      options.staleBeforeTs,
      options.staleBeforeTs,
      options.limit
    )
    .all<RevalidationEdgeRow>();
  const items = result.results ?? [];
  const nextCursor = items.length === options.limit ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
}

async function applyEdgeRevalidationUpdates(
  db: D1Database,
  updates: EdgeRevalidateUpdate[]
) {
  if (updates.length === 0) {
    return;
  }
  const rows = updates.map((update) => [
    update.status,
    update.algorithmVersion,
    update.confidenceTier,
    update.edgeType,
    update.weight,
    update.lastValidatedAt,
    update.id
  ]);
  const statements: D1PreparedStatement[] = [];
  for (const chunk of chunkRows(rows, 7)) {
    for (const row of chunk) {
      statements.push(
        db.prepare(
          `UPDATE cite_edges
          SET
            status = COALESCE(?, status),
            algorithm_version = COALESCE(?, algorithm_version),
            confidence_tier = COALESCE(?, confidence_tier),
            edge_type = COALESCE(?, edge_type),
            weight = COALESCE(?, weight),
            last_validated_at = COALESCE(?, last_validated_at)
          WHERE id = ?`
        ).bind(...row)
      );
    }
  }
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

async function runDeterministicRevalidationCron(
  env: Env,
  options?: { limit?: number; maxPages?: number }
): Promise<{ scanned: number; updated: number; pages: number }> {
  const now = nowUnixSeconds();
  const staleSeconds = parseEnvPositiveInt(
    env.REVALIDATION_DEFAULT_STALE_SECONDS,
    DEFAULT_REVALIDATION_STALE_SECONDS,
    365 * 24 * 60 * 60
  );
  const limit = options?.limit
    ? Math.min(options.limit, INTERNAL_MAX_PAGE_LIMIT)
    : parseEnvPositiveInt(
      env.REVALIDATION_CRON_PAGE_LIMIT,
      DEFAULT_REVALIDATION_CRON_PAGE_LIMIT,
      INTERNAL_MAX_PAGE_LIMIT
    );
  const maxPages = options?.maxPages
    ? Math.min(options.maxPages, 100)
    : parseEnvPositiveInt(env.REVALIDATION_CRON_MAX_PAGES, DEFAULT_REVALIDATION_CRON_MAX_PAGES, 100);
  const status = toOptionalString(env.REVALIDATION_CRON_DEFAULT_STATUS) ?? DEFAULT_REVALIDATION_STATUS;
  const confidenceTier =
    toOptionalString(env.REVALIDATION_CRON_DEFAULT_CONFIDENCE_TIER) ??
    DEFAULT_REVALIDATION_CONFIDENCE_TIER;
  const algorithmVersion =
    toOptionalString(env.REVALIDATION_CRON_ALGORITHM_VERSION) ?? DEFAULT_REVALIDATION_ALGORITHM_VERSION;
  const staleBeforeTs = now - staleSeconds;

  let cursor: string | null = null;
  let pages = 0;
  let scanned = 0;
  let updated = 0;

  while (pages < maxPages) {
    const page = await fetchEdgesForRevalidation(env.DB, {
      cursor,
      limit,
      status,
      confidenceTier,
      staleBeforeTs
    });
    if (page.items.length === 0) {
      break;
    }

    const updates = page.items.map((item) => ({
      id: item.id,
      status,
      algorithmVersion,
      confidenceTier: item.confidence_tier ?? confidenceTier,
      edgeType: null,
      weight: null,
      lastValidatedAt: now
    }));
    await applyEdgeRevalidationUpdates(env.DB, updates);

    scanned += page.items.length;
    updated += updates.length;
    pages += 1;
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }

  return { scanned, updated, pages };
}

app.use("*", async (c, next) => {
  const traceId = createTraceId(toOptionalString(c.req.header("x-trace-id")));
  requestTraceIds.set(c.req.raw, traceId);
  const startedAt = Date.now();
  c.header("x-trace-id", traceId);
  try {
    await next();
  } finally {
    const durationMs = Date.now() - startedAt;
    const metrics = buildHttpMetricFields({
      method: c.req.method,
      rawUrl: c.req.url,
      status: c.res.status,
      durationMs
    });
    c.header("x-request-duration-ms", String(metrics.duration_ms));
    recordHttpRequestMetric(metrics);
    logStructured(c, "info", "request.completed", metrics);
    requestTraceIds.delete(c.req.raw);
  }
});

app.get("/health", (c) => {
  return c.json({ ok: true, service: "api" });
});

app.get("/api/internal/vectorize-indexes", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const paperIndexName = c.env.PAPER_VECTOR_INDEX_NAME?.trim() ?? "";
  const sentenceIndexName = c.env.SENTENCE_VECTOR_INDEX_NAME?.trim() ?? "";
  const hasPaperBinding = Boolean(c.env.PAPER_VECTORS);
  const hasSentenceBinding = Boolean(c.env.SENTENCE_VECTORS);
  const ok = hasPaperBinding && hasSentenceBinding && paperIndexName.length > 0 && sentenceIndexName.length > 0;
  const payload = {
    ok,
    indexes: {
      paper: {
        binding: "PAPER_VECTORS",
        configured_name: paperIndexName || null,
        binding_present: hasPaperBinding
      },
      sentence: {
        binding: "SENTENCE_VECTORS",
        configured_name: sentenceIndexName || null,
        binding_present: hasSentenceBinding
      }
    }
  };

  if (!ok) {
    return c.json(payload, 500);
  }
  return c.json(payload);
});

app.get("/api/internal/active-users", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const limit = parsePositiveInt(
    c.req.query("limit"),
    INTERNAL_DEFAULT_PAGE_LIMIT,
    INTERNAL_MAX_PAGE_LIMIT
  );
  const cursor = toOptionalString(c.req.query("cursor"));
  try {
    const result = await c.env.DB.prepare(
      `SELECT user_id, MAX(activity_ts) AS last_activity_at
      FROM (
        SELECT user_id, updated_at AS activity_ts FROM user_interests
        UNION ALL
        SELECT user_id, COALESCE(last_opened_at, added_at) AS activity_ts FROM user_library
      )
      WHERE (? IS NULL OR user_id > ?)
      GROUP BY user_id
      ORDER BY user_id
      LIMIT ?`
    )
      .bind(cursor, cursor, limit)
      .all<{ user_id: string; last_activity_at: number | null }>();
    const items = (result.results ?? []).map((row) => ({
      user_id: row.user_id,
      last_activity_at: row.last_activity_at
    }));
    const nextCursor = items.length === limit ? items[items.length - 1]?.user_id ?? null : null;
    return c.json({ ok: true, items, next_cursor: nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Active user query failed";
    logStructured(c, "error", "internal.active_users.failed", { message });
    return jsonError(c, 500, "ACTIVE_USERS_QUERY_FAILED", message);
  }
});

app.get("/api/internal/edges-to-revalidate", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const limit = parsePositiveInt(
    c.req.query("limit"),
    INTERNAL_DEFAULT_PAGE_LIMIT,
    INTERNAL_MAX_PAGE_LIMIT
  );
  const cursor = toOptionalString(c.req.query("cursor"));
  const statusFilter = toOptionalString(c.req.query("status")) ?? DEFAULT_REVALIDATION_STATUS;
  const confidenceTierFilter =
    toOptionalString(c.req.query("confidence_tier")) ?? DEFAULT_REVALIDATION_CONFIDENCE_TIER;
  const staleBeforeTs =
    parseOptionalIntegerParam(c.req.query("stale_before_ts")) ??
    nowUnixSeconds() -
      parseEnvPositiveInt(
        c.env.REVALIDATION_DEFAULT_STALE_SECONDS,
        DEFAULT_REVALIDATION_STALE_SECONDS,
        365 * 24 * 60 * 60
      );
  try {
    const page = await fetchEdgesForRevalidation(c.env.DB, {
      cursor,
      limit,
      status: statusFilter,
      confidenceTier: confidenceTierFilter,
      staleBeforeTs
    });
    return c.json({ ok: true, items: page.items, next_cursor: page.nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Edges revalidation query failed";
    logStructured(c, "error", "internal.edges_to_revalidate.failed", { message });
    return jsonError(c, 500, "EDGES_TO_REVALIDATE_FAILED", message);
  }
});

app.post("/api/internal/revalidate-edges", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body) || !Array.isArray(body.updates)) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "payload requires updates[]");
  }

  let updates: EdgeRevalidateUpdate[];
  try {
    updates = body.updates.map((entry: unknown, index: number) =>
      normalizeEdgeRevalidateUpdate(entry, index)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid updates payload";
    return jsonError(c, 400, "INVALID_PAYLOAD", message);
  }

  try {
    await applyEdgeRevalidationUpdates(c.env.DB, updates);
    return c.json({ ok: true, updated: updates.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Edge revalidation update failed";
    logStructured(c, "error", "internal.revalidate_edges.failed", { message });
    return jsonError(c, 500, "REVALIDATE_EDGES_FAILED", message);
  }
});

app.post("/api/internal/edges-update", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body) || !Array.isArray(body.updates)) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "payload requires updates[]");
  }

  let updates: EdgeRevalidateUpdate[];
  try {
    updates = body.updates.map((entry: unknown, index: number) =>
      normalizeEdgeRevalidateUpdate(entry, index)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid updates payload";
    return jsonError(c, 400, "INVALID_PAYLOAD", message);
  }

  try {
    await applyEdgeRevalidationUpdates(c.env.DB, updates);
    return c.json({ ok: true, updated: updates.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Edge update failed";
    logStructured(c, "error", "internal.edges_update.failed", { message });
    return jsonError(c, 500, "EDGES_UPDATE_FAILED", message);
  }
});

app.post("/api/internal/revalidation-cron/run", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const limit = parsePositiveInt(
    c.req.query("limit"),
    DEFAULT_REVALIDATION_CRON_PAGE_LIMIT,
    INTERNAL_MAX_PAGE_LIMIT
  );
  const maxPages = parsePositiveInt(c.req.query("max_pages"), DEFAULT_REVALIDATION_CRON_MAX_PAGES, 100);

  try {
    const summary = await runDeterministicRevalidationCron(c.env, { limit, maxPages });
    return c.json({
      ok: true,
      source: "manual",
      scanned: summary.scanned,
      updated: summary.updated,
      pages: summary.pages
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Revalidation cron run failed";
    logStructured(c, "error", "internal.revalidation_cron.failed", { message });
    return jsonError(c, 500, "REVALIDATION_CRON_FAILED", message);
  }
});

app.get("/api/internal/ingest-log", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const limit = parsePositiveInt(c.req.query("limit"), INTERNAL_DEFAULT_PAGE_LIMIT, 500);
  const cursor = toOptionalString(c.req.query("cursor"));
  const statusFilter = toOptionalString(c.req.query("status"));
  try {
    const result = await c.env.DB.prepare(
      `SELECT id, source, status, batch_ref, error_code, metrics_json, started_at, finished_at
      FROM ingest_log
      WHERE (? IS NULL OR id > ?)
        AND (? IS NULL OR status = ?)
      ORDER BY id
      LIMIT ?`
    )
      .bind(cursor, cursor, statusFilter, statusFilter, limit)
      .all<{
        id: string;
        source: string;
        status: string;
        batch_ref: string | null;
        error_code: string | null;
        metrics_json: string | null;
        started_at: number;
        finished_at: number | null;
      }>();
    const items = (result.results ?? []).map((row) => {
      let metrics: unknown = null;
      try {
        metrics = row.metrics_json ? JSON.parse(row.metrics_json) : null;
      } catch {
        metrics = null;
      }
      return {
        id: row.id,
        source: row.source,
        status: row.status,
        batch_ref: row.batch_ref,
        error_code: row.error_code,
        metrics,
        started_at: row.started_at,
        finished_at: row.finished_at
      };
    });
    const nextCursor = items.length === limit ? items[items.length - 1]?.id ?? null : null;
    return c.json({ ok: true, items, next_cursor: nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest log query failed";
    logStructured(c, "error", "internal.ingest_log.failed", { message });
    return jsonError(c, 500, "INGEST_LOG_QUERY_FAILED", message);
  }
});

app.get("/api/internal/dlq", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const limit = parsePositiveInt(c.req.query("limit"), INTERNAL_DEFAULT_PAGE_LIMIT, INTERNAL_MAX_PAGE_LIMIT);
  const cursor = toOptionalString(c.req.query("cursor"));
  const statusFilter = toOptionalString(c.req.query("status"));
  try {
    const result = await c.env.DB.prepare(
      `SELECT
        id, batch_ref, stage, error_code, error_message,
        payload_hash, payload_bytes, paper_count, retryable, status, created_at
      FROM ingest_dlq
      WHERE (? IS NULL OR id > ?)
        AND (? IS NULL OR status = ?)
      ORDER BY id
      LIMIT ?`
    )
      .bind(cursor, cursor, statusFilter, statusFilter, limit)
      .all<{
        id: string;
        batch_ref: string | null;
        stage: string;
        error_code: string;
        error_message: string;
        payload_hash: string | null;
        payload_bytes: number | null;
        paper_count: number | null;
        retryable: number;
        status: string;
        created_at: number;
      }>();
    const items = (result.results ?? []).map((row) => ({
      id: row.id,
      batch_ref: row.batch_ref,
      stage: row.stage,
      error_code: row.error_code,
      error_message: row.error_message,
      payload_hash: row.payload_hash,
      payload_bytes: row.payload_bytes,
      paper_count: row.paper_count,
      retryable: row.retryable === 1,
      status: row.status,
      created_at: row.created_at
    }));
    const nextCursor = items.length === limit ? items[items.length - 1]?.id ?? null : null;
    return c.json({ ok: true, items, next_cursor: nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DLQ query failed";
    logStructured(c, "error", "internal.dlq.list.failed", { message });
    return jsonError(c, 500, "DLQ_QUERY_FAILED", message);
  }
});

app.post("/api/internal/dlq/:id/retry", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const dlqId = toOptionalString(c.req.param("id"));
  if (!dlqId) {
    return jsonError(c, 400, "INVALID_ID", "dlq id is required");
  }

  try {
    const row = await c.env.DB.prepare(
      `SELECT
        id, batch_ref, stage, error_code, error_message,
        payload_hash, payload_bytes, paper_count, retryable, status, created_at
      FROM ingest_dlq
      WHERE id = ?
      LIMIT 1`
    )
      .bind(dlqId)
      .first<{
        id: string;
        batch_ref: string | null;
        stage: string;
        error_code: string;
        error_message: string;
        payload_hash: string | null;
        payload_bytes: number | null;
        paper_count: number | null;
        retryable: number;
        status: string;
        created_at: number;
      }>();

    if (!row) {
      return jsonError(c, 404, "DLQ_NOT_FOUND", "dlq record not found");
    }
    if (row.retryable !== 1) {
      return jsonError(c, 400, "DLQ_NOT_RETRYABLE", "dlq record is marked non-retryable");
    }
    if (row.status === "resolved" || row.status === "discarded") {
      return jsonError(c, 400, "DLQ_ALREADY_CLOSED", `dlq record status is ${row.status}`);
    }

    const now = nowUnixSeconds();
    await c.env.DB.prepare("UPDATE ingest_dlq SET status = ?, created_at = ? WHERE id = ?")
      .bind("retry_queued", now, dlqId)
      .run();

    logStructured(c, "info", "internal.dlq.retry_queued", {
      dlq_id: dlqId,
      batch_ref: row.batch_ref,
      stage: row.stage
    });

    return c.json({
      ok: true,
      item: {
        id: row.id,
        batch_ref: row.batch_ref,
        stage: row.stage,
        error_code: row.error_code,
        error_message: row.error_message,
        payload_hash: row.payload_hash,
        payload_bytes: row.payload_bytes,
        paper_count: row.paper_count,
        retryable: true,
        status: "retry_queued",
        created_at: now
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DLQ retry failed";
    logStructured(c, "error", "internal.dlq.retry.failed", { message, dlq_id: dlqId });
    return jsonError(c, 500, "DLQ_RETRY_FAILED", message);
  }
});

app.get("/api/internal/circuit-breakers", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const limit = parsePositiveInt(c.req.query("limit"), 25, 100);
  const key = toOptionalString(c.req.query("key"));
  if (key) {
    return c.json({ ok: true, item: { key, ...getPdfCircuitBreakerSnapshot(key) } });
  }
  return c.json({ ok: true, items: listPdfCircuitBreakerSnapshots(limit) });
});

app.get("/api/internal/ingest-queue", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const limit = parsePositiveInt(c.req.query("limit"), INTERNAL_DEFAULT_PAGE_LIMIT, INTERNAL_MAX_PAGE_LIMIT);
  const now = nowUnixSeconds();
  try {
    const uploads = await c.env.DB.prepare(
      `SELECT
        id,
        user_id AS userId,
        filename,
        byte_size AS byteSize,
        storage_backend AS storageBackend,
        storage_key AS storageKey,
        status,
        expires_at AS expiresAt,
        created_at AS createdAt
      FROM paper_uploads
      WHERE status IN ('queued', 'queued_metadata_only')
        AND expires_at > ?
      ORDER BY created_at ASC
      LIMIT ?`
    )
      .bind(now, limit)
      .all<{
        id: string;
        userId: string;
        filename: string | null;
        byteSize: number;
        storageBackend: string;
        storageKey: string | null;
        status: string;
        expiresAt: number;
        createdAt: number;
      }>();

    const pending = await c.env.DB.prepare(
      `SELECT id, user_id AS userId, source_ref AS sourceRef, payload_json AS payloadJson, status, created_at AS createdAt
      FROM pending_bibs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT ?`
    )
      .bind(limit)
      .all<{
        id: string;
        userId: string;
        sourceRef: string;
        payloadJson: string | null;
        status: string;
        createdAt: number;
      }>();

    return c.json({
      ok: true,
      queue_backend: "d1_stub",
      note: "Colab consumer polls this endpoint; CF Queue binding optional in Phase 2",
      pdf_uploads: uploads.results ?? [],
      pending_bibs: (pending.results ?? []).map((row) => ({
        id: row.id,
        user_id: row.userId,
        source_ref: row.sourceRef,
        status: row.status,
        created_at: row.createdAt,
        payload: row.payloadJson ? JSON.parse(row.payloadJson) : null
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest queue query failed";
    return jsonError(c, 500, "INGEST_QUEUE_FAILED", message);
  }
});

function getColabHeartbeatSnapshot(now = nowUnixSeconds()) {
  if (!colabHeartbeatState) {
    return {
      last_seen_at: null,
      stale: true,
      stale_after_seconds: HEARTBEAT_STALE_SECONDS,
      run_id: null,
      platform: null,
      processed: null,
      last_doi: null
    };
  }
  const ageSeconds = now - colabHeartbeatState.lastSeenAt;
  return {
    last_seen_at: colabHeartbeatState.lastSeenAt,
    stale: ageSeconds > HEARTBEAT_STALE_SECONDS,
    stale_after_seconds: HEARTBEAT_STALE_SECONDS,
    age_seconds: ageSeconds,
    run_id: colabHeartbeatState.runId,
    platform: colabHeartbeatState.platform,
    processed: colabHeartbeatState.processed,
    last_doi: colabHeartbeatState.lastDoi
  };
}

app.post("/api/internal/heartbeat", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const payload = isRecord(body) ? body : {};
  const now = nowUnixSeconds();
  colabHeartbeatState = {
    lastSeenAt: now,
    runId: toOptionalString(payload.run_id ?? payload.runId),
    platform: toOptionalString(payload.platform),
    processed: toOptionalNumber(payload.processed),
    lastDoi: toOptionalString(payload.last_doi ?? payload.lastDoi)
  };

  return c.json({
    ok: true,
    received_at: now,
    heartbeat: getColabHeartbeatSnapshot(now)
  });
});

app.get("/api/internal/heartbeat", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const snapshot = getColabHeartbeatSnapshot();
  return c.json({
    ok: true,
    heartbeat: snapshot
  });
});

app.get("/api/internal/dlq/summary", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const recentLimit = parsePositiveInt(c.req.query("recent_limit"), 10, 50);
  const queueLimit = parsePositiveInt(c.req.query("queue_limit"), INTERNAL_DEFAULT_PAGE_LIMIT, INTERNAL_MAX_PAGE_LIMIT);
  const now = nowUnixSeconds();

  try {
    const [statusCounts, recentRows, uploadCount, pendingCount, uploads, pending] = await Promise.all([
      c.env.DB.prepare(
        `SELECT status, COUNT(*) AS count
        FROM ingest_dlq
        GROUP BY status
        ORDER BY status
        LIMIT 20`
      ).all<{ status: string; count: number }>(),
      c.env.DB.prepare(
        `SELECT
          id, batch_ref, stage, error_code, error_message,
          payload_hash, payload_bytes, paper_count, retryable, status, created_at
        FROM ingest_dlq
        ORDER BY created_at DESC
        LIMIT ?`
      )
        .bind(recentLimit)
        .all<{
          id: string;
          batch_ref: string | null;
          stage: string;
          error_code: string;
          error_message: string;
          payload_hash: string | null;
          payload_bytes: number | null;
          paper_count: number | null;
          retryable: number;
          status: string;
          created_at: number;
        }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count
        FROM paper_uploads
        WHERE status IN ('queued', 'queued_metadata_only')
          AND expires_at > ?`
      )
        .bind(now)
        .first<{ count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count
        FROM pending_bibs
        WHERE status = 'queued'`
      ).first<{ count: number }>(),
      c.env.DB.prepare(
        `SELECT
          id,
          user_id AS userId,
          filename,
          byte_size AS byteSize,
          storage_backend AS storageBackend,
          status,
          expires_at AS expiresAt,
          created_at AS createdAt
        FROM paper_uploads
        WHERE status IN ('queued', 'queued_metadata_only')
          AND expires_at > ?
        ORDER BY created_at ASC
        LIMIT ?`
      )
        .bind(now, queueLimit)
        .all<{
          id: string;
          userId: string;
          filename: string | null;
          byteSize: number;
          storageBackend: string;
          status: string;
          expiresAt: number;
          createdAt: number;
        }>(),
      c.env.DB.prepare(
        `SELECT id, user_id AS userId, source_ref AS sourceRef, status, created_at AS createdAt
        FROM pending_bibs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT ?`
      )
        .bind(queueLimit)
        .all<{
          id: string;
          userId: string;
          sourceRef: string;
          status: string;
          createdAt: number;
        }>()
    ]);

    const dlqByStatus = Object.fromEntries(
      (statusCounts.results ?? []).map((row) => [row.status, row.count])
    );
    const dlqTotal = Object.values(dlqByStatus).reduce((sum, count) => sum + count, 0);

    return c.json({
      ok: true,
      generated_at: now,
      dlq: {
        total: dlqTotal,
        by_status: dlqByStatus,
        recent: (recentRows.results ?? []).map((row) => ({
          id: row.id,
          batch_ref: row.batch_ref,
          stage: row.stage,
          error_code: row.error_code,
          error_message: row.error_message,
          payload_hash: row.payload_hash,
          payload_bytes: row.payload_bytes,
          paper_count: row.paper_count,
          retryable: row.retryable === 1,
          status: row.status,
          created_at: row.created_at
        }))
      },
      queue: {
        backend: "d1_stub",
        pdf_uploads_total: uploadCount?.count ?? 0,
        pending_bibs_total: pendingCount?.count ?? 0,
        pdf_uploads: uploads.results ?? [],
        pending_bibs: (pending.results ?? []).map((row) => ({
          id: row.id,
          user_id: row.userId,
          source_ref: row.sourceRef,
          status: row.status,
          created_at: row.createdAt
        }))
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DLQ summary query failed";
    logStructured(c, "error", "internal.dlq.summary.failed", { message });
    return jsonError(c, 500, "DLQ_SUMMARY_FAILED", message);
  }
});

app.get("/api/internal/metrics/summary", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const topPaths = parsePositiveInt(c.req.query("top_paths"), 20, 100);
  const summary = buildHttpMetricsSummary(topPaths);
  const circuitBreakers = listPdfCircuitBreakerSnapshots(25);
  const heartbeat = getColabHeartbeatSnapshot();
  return c.json({
    ok: true,
    metrics: summary,
    pdf_circuit_breakers: circuitBreakers,
    colab_heartbeat: heartbeat
  });
});

app.post("/api/internal/pending-bibs/retry", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const payload = isRecord(body) ? body : {};
  const retryAt = nowUnixSeconds();
  const limit = parsePositiveInt(
    typeof payload.limit === "number" ? String(payload.limit) : undefined,
    INTERNAL_DEFAULT_PAGE_LIMIT,
    500
  );
  const explicitIds = toOptionalStringArray(payload.ids);
  try {
    let ids = explicitIds;
    if (ids.length === 0) {
      const dueRows = await c.env.DB.prepare(
        `SELECT id
        FROM pending_bibs
        WHERE status IN ('queued', 'failed', 'retrying')
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY COALESCE(next_retry_at, 0), updated_at
        LIMIT ?`
      )
        .bind(retryAt, limit)
        .all<{ id: string }>();
      ids = (dueRows.results ?? []).map((row) => row.id);
    }
    if (ids.length === 0) {
      return c.json({ ok: true, queued: 0, items: [] });
    }

    const placeholders = ids.map(() => "?").join(", ");
    const nextRetryAt = retryAt + 15 * 60;
    await c.env.DB.prepare(
      `UPDATE pending_bibs
      SET retry_count = retry_count + 1,
          status = 'retrying',
          next_retry_at = ?,
          updated_at = ?
      WHERE id IN (${placeholders})`
    )
      .bind(nextRetryAt, retryAt, ...ids)
      .run();

    const reloaded = await c.env.DB.prepare(
      `SELECT id, user_id, source_ref, status, retry_count, next_retry_at, payload_json, updated_at
      FROM pending_bibs
      WHERE id IN (${placeholders})
      ORDER BY updated_at DESC
      LIMIT ?`
    )
      .bind(...ids, ids.length)
      .all<{
        id: string;
        user_id: string;
        source_ref: string;
        status: string;
        retry_count: number;
        next_retry_at: number | null;
        payload_json: string | null;
        updated_at: number;
      }>();

    const items = (reloaded.results ?? []).map((row) => {
      let payloadJson: unknown = null;
      try {
        payloadJson = row.payload_json ? JSON.parse(row.payload_json) : null;
      } catch {
        payloadJson = null;
      }
      return {
        id: row.id,
        user_id: row.user_id,
        source_ref: row.source_ref,
        status: row.status,
        retry_count: row.retry_count,
        next_retry_at: row.next_retry_at,
        payload: payloadJson,
        updated_at: row.updated_at
      };
    });
    return c.json({ ok: true, queued: ids.length, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pending bib retry failed";
    logStructured(c, "error", "internal.pending_bibs.retry.failed", { message });
    return jsonError(c, 500, "PENDING_BIBS_RETRY_FAILED", message);
  }
});

app.post("/api/internal/feed-generate", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body) || !Array.isArray(body.items) || body.items.length === 0) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "payload requires non-empty items[]");
  }

  type FeedItemInsert = [string, string, string, string, number | null, number, number];
  const now = nowUnixSeconds();
  const rows: FeedItemInsert[] = [];
  const unresolved: { index: number; reason: string }[] = [];

  for (let index = 0; index < body.items.length; index += 1) {
    const item = body.items[index];
    if (!isRecord(item)) {
      unresolved.push({ index, reason: "item must be an object" });
      continue;
    }
    const userId = toOptionalString(item.userId ?? item.user_id);
    const providedNodeId = toOptionalString(item.nodeId ?? item.node_id);
    const doiNorm = normalizeDoiForStorage(toOptionalString(item.doi) ?? "");
    const reasonCode = toOptionalString(item.reasonCode ?? item.reason_code) ?? "topic_match";
    const score = toOptionalNumber(item.score);
    const eventTs = toOptionalNumber(item.eventTs ?? item.event_ts) ?? now;
    if (!userId) {
      unresolved.push({ index, reason: "userId is required" });
      continue;
    }
    let nodeId = providedNodeId;
    if (!nodeId && doiNorm) {
      nodeId = await resolveNodeIdByDoi(c, doiNorm);
    }
    if (!nodeId) {
      unresolved.push({ index, reason: "nodeId/doi did not resolve" });
      continue;
    }
    rows.push([
      toOptionalString(item.id) ?? makeId("feed"),
      userId,
      nodeId,
      reasonCode,
      score,
      Math.trunc(eventTs),
      now
    ]);
  }

  if (rows.length === 0) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "no feed item resolved to node_id");
  }

  try {
    const statements: D1PreparedStatement[] = [];
    for (const chunk of chunkRows(rows, 7)) {
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO feed_items (id, user_id, node_id, reason_code, score, event_ts, created_at)
          VALUES ${placeholders}
          ON CONFLICT(id) DO UPDATE SET
            user_id = excluded.user_id,
            node_id = excluded.node_id,
            reason_code = excluded.reason_code,
            score = excluded.score,
            event_ts = excluded.event_ts`
        ).bind(...chunk.flat())
      );
    }
    await c.env.DB.batch(statements);
    return c.json({ ok: true, inserted: rows.length, unresolved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Feed generation ingest failed";
    logStructured(c, "error", "internal.feed_generate.failed", { message });
    return jsonError(c, 500, "FEED_GENERATE_FAILED", message);
  }
});

app.post("/api/cite/bulk-ingest", async (c) => {
  const tokenError = requireColabToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INGEST_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  const batchRef = resolveTraceId(c);
  let parsedPayload: BulkIngestPayload;
  let payloadBytes: number | null = null;
  let payloadHash: string | null = null;
  let maxPapersPerChunk = DEFAULT_BULK_INGEST_MAX_PAPERS_PER_CHUNK;
  let papersInChunk = 0;
  try {
    const parsedBody = await parseBulkIngestBodyWithGuards(c);
    parsedPayload = parsedBody.payload;
    payloadBytes = parsedBody.rawBytes;
    payloadHash = parsedBody.payloadHash;
    maxPapersPerChunk = parsedBody.maxPapersPerChunk;
    papersInChunk = parsedBody.papersInChunk;
  } catch (error) {
    if (error instanceof RequestPolicyError) {
      return jsonError(c, error.status, error.code, error.message);
    }
    const message = error instanceof Error ? error.message : "Invalid payload";
    return jsonError(c, 400, "INVALID_PAYLOAD", message);
  }

  try {
    await runVectorUpsertHook(c, parsedPayload.vectors);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vector upsert failed";
    await writeBulkIngestDlqRecord(c, {
      stage: "vector_upsert",
      errorCode: "VECTOR_UPSERT_FAILED",
      message,
      payloadHash,
      payloadBytes,
      paperCount: papersInChunk,
      batchRef
    });
    return jsonError(c, 500, "VECTOR_UPSERT_FAILED", message);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];

  if (parsedPayload.nodes.length > 0) {
    const nodeRows = parsedPayload.nodes.map((node) => [
      node.id,
      node.source,
      node.sourceRef,
      node.title,
      node.doiNorm,
      node.publicationYear,
      node.venue,
      node.nodeType ?? "paper",
      node.metadataJson,
      nowSec
    ]);
    for (const chunk of chunkRows(nodeRows, 10)) {
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const binds = chunk.flat();
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO cite_nodes (
            id, source, source_ref, title, doi_norm, publication_year,
            venue, node_type, metadata_json, updated_at
          ) VALUES ${placeholders}
          ON CONFLICT(id) DO UPDATE SET
            source = excluded.source,
            source_ref = excluded.source_ref,
            title = excluded.title,
            doi_norm = excluded.doi_norm,
            publication_year = excluded.publication_year,
            venue = excluded.venue,
            node_type = excluded.node_type,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at`
        ).bind(...binds)
      );
    }

    const searchRows = parsedPayload.nodes.map((node) => [
      node.id,
      node.title,
      node.authorsText,
      node.venue,
      node.topicTerms,
      node.publicationYear,
      node.doiNorm,
      node.rankSignal ?? 0,
      nowSec
    ]);
    for (const chunk of chunkRows(searchRows, 9)) {
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const binds = chunk.flat();
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO paper_search (
            node_id, title, authors_text, venue, topic_terms,
            publication_year, doi_norm, rank_signal, updated_at
          ) VALUES ${placeholders}
          ON CONFLICT(node_id) DO UPDATE SET
            title = excluded.title,
            authors_text = excluded.authors_text,
            venue = excluded.venue,
            topic_terms = excluded.topic_terms,
            publication_year = excluded.publication_year,
            doi_norm = excluded.doi_norm,
            rank_signal = excluded.rank_signal,
            updated_at = excluded.updated_at`
        ).bind(...binds)
      );
    }
  }

  if (parsedPayload.edges.length > 0) {
    const edgeRows = parsedPayload.edges.map((edge) => [
      edge.id,
      edge.fromNodeId,
      edge.toNodeId,
      edge.edgeType,
      edge.weight,
      edge.evidenceRef,
      nowSec
    ]);
    for (const chunk of chunkRows(edgeRows, 7)) {
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
      const binds = chunk.flat();
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO cite_edges (
            id, from_node_id, to_node_id, edge_type, weight, evidence_ref, created_at
          ) VALUES ${placeholders}
          ON CONFLICT(id) DO UPDATE SET
            from_node_id = excluded.from_node_id,
            to_node_id = excluded.to_node_id,
            edge_type = excluded.edge_type,
            weight = excluded.weight,
            evidence_ref = excluded.evidence_ref`
        ).bind(...binds)
      );
    }
  }

  try {
    if (statements.length > 0) {
      await c.env.DB.batch(statements);
    }
    const aliasCount = await upsertDoiAliasesFromBulkIngest(c, parsedPayload);
    return c.json({
      ok: true,
      chunk_policy: {
        papers_in_chunk: papersInChunk,
        max_papers_per_chunk: maxPapersPerChunk,
        payload_bytes: payloadBytes
      },
      ingested: {
        nodes: parsedPayload.nodes.length,
        edges: parsedPayload.edges.length,
        doi_aliases: aliasCount,
        vectors: {
          sentence: parsedPayload.vectors.sentence.length,
          paper: parsedPayload.vectors.paper.length
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk ingest failed";
    await writeBulkIngestDlqRecord(c, {
      stage: "d1_batch",
      errorCode: "BULK_INGEST_FAILED",
      message,
      payloadHash,
      payloadBytes,
      paperCount: papersInChunk,
      batchRef
    });
    return jsonError(c, 500, "BULK_INGEST_FAILED", message);
  }
});

app.post("/api/paper/bulk-upsert", async (c) => {
  const tokenError = requireColabToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INGEST_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  let parsedPayload: BulkUpsertPayload;
  try {
    const payload = await c.req.json();
    parsedPayload = parseBulkUpsertPayload(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid payload";
    return jsonError(c, 400, "INVALID_PAYLOAD", message);
  }

  try {
    await applyBulkPaperUpsert(c.env.DB, parsedPayload, nowUnixSeconds());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk paper upsert failed";
    return jsonError(c, 500, "BULK_UPSERT_FAILED", message);
  }

  return c.json({
    ok: true,
    upserted: {
      papers: parsedPayload.papers.length,
      authors: parsedPayload.authors.length,
      topics: parsedPayload.topics.length
    }
  });
});

app.post("/api/internal/openalex/bulk-upsert", async (c) => {
  const tokenError = requireInternalToken(c);
  if (tokenError) {
    const status = tokenError.error.code === "INTERNAL_TOKEN_MISSING" ? 500 : 401;
    return jsonError(c, status, tokenError.error.code, tokenError.error.message);
  }

  let parsedPayload: BulkUpsertPayload;
  try {
    const payload = await c.req.json();
    parsedPayload = parseBulkUpsertPayload(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid payload";
    return jsonError(c, 400, "INVALID_PAYLOAD", message);
  }

  try {
    await applyBulkPaperUpsert(c.env.DB, parsedPayload, nowUnixSeconds());
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAlex bulk upsert failed";
    return jsonError(c, 500, "OPENALEX_BULK_UPSERT_FAILED", message);
  }

  return c.json({
    ok: true,
    source: "internal_openalex",
    upserted: {
      papers: parsedPayload.papers.length,
      authors: parsedPayload.authors.length,
      topics: parsedPayload.topics.length
    }
  });
});

app.get("/api/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (q.length < 2) {
    return jsonError(c, 400, "INVALID_QUERY", "q must be at least 2 characters");
  }
  const ftsQuery = toFtsQuery(q);
  if (!ftsQuery) {
    return jsonError(c, 400, "INVALID_QUERY", "q did not produce searchable terms");
  }
  const parsedFilters = parseSearchFilters(c);
  if (typeof parsedFilters === "string") {
    return jsonError(c, 400, "INVALID_FILTERS", parsedFilters);
  }

  const limit = parsedFilters.limit;
  const candidateLimit = Math.min(MAX_SEARCH_LIMIT * 4, Math.max(limit * 4, limit));
  const { clauses: commonClauses, binds: commonBinds } = buildSearchFilterClauses(
    {
      yearFrom: parsedFilters.yearFrom,
      yearTo: parsedFilters.yearTo,
      minCitations: parsedFilters.minCitations,
      journal: parsedFilters.journal,
      author: parsedFilters.author,
      topic: parsedFilters.topic
    },
    "ps"
  );

  try {
    const ftsWhere = ["paper_fts MATCH ?", ...commonClauses].join(" AND ");
    const ftsRowsResult = await c.env.DB.prepare(
      `SELECT
        ps.node_id AS nodeId,
        ps.title AS title,
        ps.authors_text AS authorsText,
        ps.venue AS venue,
        ps.publication_year AS publicationYear,
        ps.doi_norm AS doiNorm,
        ps.tldr AS tldr,
        ps.rank_signal AS rankSignal,
        bm25(paper_fts) AS score
      FROM paper_fts
      JOIN paper_search AS ps ON ps.id = paper_fts.rowid
      WHERE ${ftsWhere}
      ORDER BY score ASC, ps.rank_signal DESC
      LIMIT ?`
    )
      .bind(ftsQuery, ...commonBinds, candidateLimit)
      .all<SearchCandidateRow>();

    const ftsRows = (ftsRowsResult.results ?? []).map(normalizeSearchCandidateRow);

    let vectorRows: SearchResult[] = [];
    const queryEmbedding = await getQueryEmbedding(c, q, c.req.query("query_vector"));
    if (queryEmbedding) {
      const vectorResult = await (c.env.PAPER_VECTORS as unknown as {
        query: (
          vector: number[],
          options: { topK: number; returnValues?: boolean; returnMetadata?: boolean }
        ) => Promise<unknown>;
      }).query(queryEmbedding, {
        topK: Math.min(MAX_SEARCH_LIMIT * 6, Math.max(limit * 5, limit)),
        returnValues: false,
        returnMetadata: false
      });

      const matches = isRecord(vectorResult) && Array.isArray(vectorResult.matches)
        ? vectorResult.matches
        : [];
      const vectorIds = matches
        .map((match) =>
          isRecord(match) && typeof match.id === "string" ? match.id.trim() : ""
        )
        .filter((id) => id.length > 0);

      if (vectorIds.length > 0) {
        const uniqueVectorIds = Array.from(new Set(vectorIds)).slice(0, MAX_SEARCH_LIMIT * 8);
        const idPlaceholders = uniqueVectorIds.map(() => "?").join(", ");
        const vectorWhereClauses = [`ps.node_id IN (${idPlaceholders})`, ...commonClauses];
        const vectorRowsResult = await c.env.DB.prepare(
          `SELECT
            ps.node_id AS nodeId,
            ps.title AS title,
            ps.authors_text AS authorsText,
            ps.venue AS venue,
            ps.publication_year AS publicationYear,
            ps.doi_norm AS doiNorm,
            ps.tldr AS tldr,
            ps.rank_signal AS rankSignal
          FROM paper_search AS ps
          WHERE ${vectorWhereClauses.join(" AND ")}`
        )
          .bind(...uniqueVectorIds, ...commonBinds)
          .all<SearchCandidateRow>();

        const vectorRowMap = new Map<string, SearchResult>();
        for (const row of vectorRowsResult.results ?? []) {
          const normalizedRow = normalizeSearchCandidateRow(row);
          vectorRowMap.set(normalizedRow.nodeId, normalizedRow);
        }
        vectorRows = vectorIds
          .map((id) => vectorRowMap.get(id))
          .filter((value): value is SearchResult => Boolean(value))
          .slice(0, candidateLimit);
      }
    }

    const merged = new Map<string, SearchAccumulator>();
    addRrfScores(merged, ftsRows, "fts");
    addRrfScores(merged, vectorRows, "vector");
    let items = Array.from(merged.values())
      .sort((a, b) => {
        if (b.rrfScore !== a.rrfScore) {
          return b.rrfScore - a.rrfScore;
        }
        return b.item.rankSignal - a.item.rankSignal;
      })
      .slice(0, limit)
      .map((entry) => ({
        ...entry.item,
        score: Number(entry.rrfScore.toFixed(8))
      }));

    items = sortSearchItems(items, parsedFilters.sort);
    items = await attachInfluentialCounts(c.env.DB, items);

    return c.json({
      ok: true,
      q,
      filters: {
        year_from: parsedFilters.yearFrom,
        year_to: parsedFilters.yearTo,
        min_citations: parsedFilters.minCitations,
        journal: parsedFilters.journal,
        author: parsedFilters.author,
        topic: parsedFilters.topic,
        sort: parsedFilters.sort
      },
      limit,
      ranking: {
        algorithm: "rrf",
        k: RRF_K,
        sources: {
          fts: ftsRows.length,
          vector: vectorRows.length
        }
      },
      items
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return jsonError(c, 500, "SEARCH_FAILED", message);
  }
});

app.get("/api/cite/timeline", async (c) => {
  const id = c.req.query("id")?.trim();
  if (!id) {
    return jsonError(c, 400, "MISSING_ID", "id query parameter is required");
  }

  const planInput = (c.req.query("plan") ?? c.req.query("tier") ?? "free").trim().toLowerCase();
  const plan = planInput === "pro" ? "pro" : "free";
  const planLimit = plan === "pro" ? PRO_TIMELINE_LIMIT : FREE_TIMELINE_LIMIT;
  const requestedLimit = parsePositiveInt(c.req.query("limit"), planLimit, PRO_TIMELINE_LIMIT);
  const limit = Math.min(requestedLimit, planLimit);

  try {
    const result = await c.env.DB.prepare(
      `SELECT
        e.id AS edgeId,
        e.edge_type AS edgeType,
        e.weight AS weight,
        e.evidence_ref AS evidenceRef,
        e.confidence_tier AS confidenceTier,
        CASE
          WHEN e.from_node_id = ? THEN 'outbound'
          ELSE 'inbound'
        END AS direction,
        n.id AS relatedNodeId,
        n.title AS title,
        n.publication_year AS publicationYear,
        n.venue AS venue,
        n.doi_norm AS doiNorm,
        ps.authors_text AS authorsText,
        ps.topic_terms AS topicTerms,
        evidence.metadata_json AS evidenceMetadata,
        evidence.source_ref AS evidenceSourceRef
      FROM cite_edges AS e
      JOIN cite_nodes AS n
        ON n.id = CASE
          WHEN e.from_node_id = ? THEN e.to_node_id
          ELSE e.from_node_id
        END
      LEFT JOIN paper_search AS ps ON ps.node_id = n.id
      LEFT JOIN cite_nodes AS evidence ON evidence.id = e.from_node_id
      WHERE e.from_node_id = ? OR e.to_node_id = ?
      ORDER BY COALESCE(n.publication_year, 9999) ASC, n.title ASC
      LIMIT ?`
    )
      .bind(id, id, id, id, limit)
      .all<TimelineCard>();

    const items = (result.results ?? [])
      .map((row) => enrichTimelineItem(row))
      .sort((a, b) => {
        if (a.isInfluential !== b.isInfluential) {
          return a.isInfluential ? -1 : 1;
        }
        const yearA = a.publicationYear ?? 9999;
        const yearB = b.publicationYear ?? 9999;
        if (yearA !== yearB) {
          return yearA - yearB;
        }
        return (b.ceScore ?? 0) - (a.ceScore ?? 0);
      });

    return c.json({
      ok: true,
      id,
      plan,
      tierLimit: planLimit,
      limit,
      items
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Timeline query failed";
    return jsonError(c, 500, "TIMELINE_FAILED", message);
  }
});

app.post("/api/cite/edges/:id/report", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  const edgeId = toOptionalString(c.req.param("id"));
  if (!edgeId) {
    return jsonError(c, 400, "INVALID_EDGE_ID", "edge id path parameter is required");
  }

  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const payload = isRecord(body) ? body : {};
  const flagCode = toOptionalString(payload.flagCode ?? payload.flag_code) ?? "wrong_citation";
  const reasonCode = toOptionalString(payload.reasonCode ?? payload.reason_code);
  const now = nowUnixSeconds();

  try {
    const edgeExists = await c.env.DB.prepare("SELECT id FROM cite_edges WHERE id = ? LIMIT 1")
      .bind(edgeId)
      .first<{ id: string }>();
    if (!edgeExists) {
      return jsonError(c, 404, "EDGE_NOT_FOUND", "edge does not exist");
    }

    const existingFlag = await c.env.DB.prepare(
      `SELECT id FROM edge_flags
      WHERE edge_id = ? AND user_id = ?
      LIMIT 1`
    )
      .bind(edgeId, user.userId)
      .first<{ id: string }>();

    if (!existingFlag) {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO edge_flags (
            id, edge_id, user_id, flag_code, reason_code, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(makeId("flag"), edgeId, user.userId, flagCode, reasonCode, now),
        c.env.DB.prepare(
          `UPDATE cite_edges
          SET flagged_count = COALESCE(flagged_count, 0) + 1,
              status = CASE WHEN COALESCE(flagged_count, 0) + 1 >= 3 THEN 'review_queue' ELSE status END,
              last_validated_at = ?
          WHERE id = ?`
        ).bind(now, edgeId)
      ]);
    }

    const summary = await c.env.DB.prepare(
      `SELECT
        COALESCE(flagged_count, 0) AS flaggedCount,
        COALESCE(status, 'active') AS status
      FROM cite_edges
      WHERE id = ?
      LIMIT 1`
    )
      .bind(edgeId)
      .first<{ flaggedCount: number; status: string }>();

    return c.json({
      ok: true,
      edge_id: edgeId,
      duplicate: Boolean(existingFlag),
      flagged_count: summary?.flaggedCount ?? 0,
      status: summary?.status ?? "active"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Edge report failed";
    return jsonError(c, 500, "EDGE_REPORT_FAILED", message);
  }
});

app.get("/api/authors/:name", async (c) => {
  const authorName = decodeURIComponent(c.req.param("name")).trim();
  if (authorName.length < 2) {
    return jsonError(c, 400, "INVALID_AUTHOR", "author name must be at least 2 characters");
  }
  const like = `%${authorName}%`;
  const limit = parsePositiveInt(c.req.query("limit"), 20, 50);

  try {
    const summaryResult = await c.env.DB.prepare(
      `SELECT
        pa.author_name AS authorName,
        COUNT(DISTINCT pa.node_id) AS paperCount,
        COUNT(DISTINCT ce.id) AS edgeCount,
        COALESCE(SUM(ps.rank_signal), 0) AS totalRankSignal
      FROM paper_authors pa
      LEFT JOIN cite_edges ce
        ON ce.from_node_id = pa.node_id OR ce.to_node_id = pa.node_id
      LEFT JOIN paper_search ps ON ps.node_id = pa.node_id
      WHERE LOWER(pa.author_name) LIKE LOWER(?)
      GROUP BY pa.author_name
      ORDER BY paperCount DESC, totalRankSignal DESC
      LIMIT 1`
    )
      .bind(like)
      .first<{
        authorName: string;
        paperCount: number;
        edgeCount: number;
        totalRankSignal: number;
      }>();

    const papersResult = await c.env.DB.prepare(
      `SELECT
        ps.node_id AS nodeId,
        ps.title AS title,
        ps.doi_norm AS doiNorm,
        ps.publication_year AS publicationYear,
        ps.venue AS venue,
        ps.rank_signal AS rankSignal
      FROM paper_authors pa
      JOIN paper_search ps ON ps.node_id = pa.node_id
      WHERE LOWER(pa.author_name) LIKE LOWER(?)
      ORDER BY COALESCE(ps.rank_signal, 0) DESC, COALESCE(ps.publication_year, 0) DESC, ps.title ASC
      LIMIT ?`
    )
      .bind(like, limit)
      .all<{
        nodeId: string;
        title: string;
        doiNorm: string | null;
        publicationYear: number | null;
        venue: string | null;
        rankSignal: number | null;
      }>();

    return c.json({
      ok: true,
      query: authorName,
      summary: summaryResult ?? {
        authorName,
        paperCount: 0,
        edgeCount: 0,
        totalRankSignal: 0
      },
      items: papersResult.results ?? []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Author query failed";
    return jsonError(c, 500, "AUTHORS_QUERY_FAILED", message);
  }
});

app.get("/api/authors/:name/coauthors", async (c) => {
  const authorName = decodeURIComponent(c.req.param("name")).trim();
  if (authorName.length < 2) {
    return jsonError(c, 400, "INVALID_AUTHOR", "author name must be at least 2 characters");
  }
  const like = `%${authorName}%`;
  const limit = parsePositiveInt(c.req.query("limit"), 30, 100);

  try {
    const result = await c.env.DB.prepare(
      `SELECT
        pa2.author_id AS authorId,
        pa2.author_name AS authorName,
        COUNT(DISTINCT pa1.node_id) AS sharedPaperCount
      FROM paper_authors pa1
      JOIN paper_authors pa2
        ON pa1.node_id = pa2.node_id AND pa1.author_id != pa2.author_id
      WHERE LOWER(pa1.author_name) LIKE LOWER(?)
      GROUP BY pa2.author_id, pa2.author_name
      ORDER BY sharedPaperCount DESC, pa2.author_name ASC
      LIMIT ?`
    )
      .bind(like, limit)
      .all<{
        authorId: string;
        authorName: string;
        sharedPaperCount: number;
      }>();

    return c.json({
      ok: true,
      query: authorName,
      items: result.results ?? []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Coauthor query failed";
    return jsonError(c, 500, "COAUTHORS_QUERY_FAILED", message);
  }
});

app.get("/api/authors/:name/cites", async (c) => {
  const authorName = decodeURIComponent(c.req.param("name")).trim();
  if (authorName.length < 2) {
    return jsonError(c, 400, "INVALID_AUTHOR", "author name must be at least 2 characters");
  }
  const direction = (c.req.query("direction") ?? "outbound").trim().toLowerCase();
  if (!["outbound", "inbound", "all"].includes(direction)) {
    return jsonError(c, 400, "INVALID_DIRECTION", "direction must be outbound, inbound, or all");
  }
  const like = `%${authorName}%`;
  const limit = parsePositiveInt(c.req.query("limit"), 30, 100);

  const outboundSql = `
    SELECT
      target.author_id AS authorId,
      target.author_name AS authorName,
      COUNT(DISTINCT e.id) AS edgeCount,
      COUNT(DISTINCT e.from_node_id) AS sourcePaperCount,
      COALESCE(SUM(ps.rank_signal), 0) AS targetRankSignal,
      'outbound' AS direction
    FROM cite_edges e
    JOIN paper_authors source ON source.node_id = e.from_node_id
    JOIN paper_authors target ON target.node_id = e.to_node_id
    LEFT JOIN paper_search ps ON ps.node_id = e.to_node_id
    WHERE LOWER(source.author_name) LIKE LOWER(?)
    GROUP BY target.author_id, target.author_name
  `;
  const inboundSql = `
    SELECT
      source.author_id AS authorId,
      source.author_name AS authorName,
      COUNT(DISTINCT e.id) AS edgeCount,
      COUNT(DISTINCT e.to_node_id) AS sourcePaperCount,
      COALESCE(SUM(ps.rank_signal), 0) AS targetRankSignal,
      'inbound' AS direction
    FROM cite_edges e
    JOIN paper_authors source ON source.node_id = e.from_node_id
    JOIN paper_authors target ON target.node_id = e.to_node_id
    LEFT JOIN paper_search ps ON ps.node_id = e.from_node_id
    WHERE LOWER(target.author_name) LIKE LOWER(?)
    GROUP BY source.author_id, source.author_name
  `;

  let sql = outboundSql;
  if (direction === "inbound") {
    sql = inboundSql;
  }
  if (direction === "all") {
    sql = `${outboundSql} UNION ALL ${inboundSql}`;
  }

  try {
    const binds = direction === "all" ? [like, like, limit] : [like, limit];
    const result = await c.env.DB.prepare(
      `SELECT
        authorId,
        authorName,
        SUM(edgeCount) AS edgeCount,
        SUM(sourcePaperCount) AS sourcePaperCount,
        SUM(targetRankSignal) AS targetRankSignal,
        MIN(direction) AS direction
      FROM (${sql})
      GROUP BY authorId, authorName
      ORDER BY edgeCount DESC, targetRankSignal DESC, authorName ASC
      LIMIT ?`
    )
      .bind(...binds)
      .all<{
        authorId: string;
        authorName: string;
        edgeCount: number;
        sourcePaperCount: number;
        targetRankSignal: number;
        direction: string;
      }>();

    return c.json({
      ok: true,
      query: authorName,
      direction,
      items: result.results ?? []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Author cite query failed";
    return jsonError(c, 500, "AUTHOR_CITES_FAILED", message);
  }
});

app.get("/api/topics/:name/evolution", async (c) => {
  const topicName = decodeURIComponent(c.req.param("name")).trim();
  if (topicName.length < 2) {
    return jsonError(c, 400, "INVALID_TOPIC", "topic name must be at least 2 characters");
  }
  const like = `%${topicName}%`;
  const topPerYear = parsePositiveInt(c.req.query("top_per_year"), 5, 10);

  try {
    const yearlyResult = await c.env.DB.prepare(
      `SELECT
        ps.publication_year AS year,
        COUNT(DISTINCT pt.node_id) AS paperCount,
        COALESCE(SUM(ps.rank_signal), 0) AS totalRankSignal
      FROM paper_topics pt
      JOIN paper_search ps ON ps.node_id = pt.node_id
      WHERE LOWER(pt.topic) LIKE LOWER(?)
        AND ps.publication_year IS NOT NULL
      GROUP BY ps.publication_year
      ORDER BY ps.publication_year ASC`
    )
      .bind(like)
      .all<{ year: number; paperCount: number; totalRankSignal: number }>();

    const topRowsResult = await c.env.DB.prepare(
      `SELECT
        ps.publication_year AS year,
        ps.node_id AS nodeId,
        ps.title AS title,
        ps.doi_norm AS doiNorm,
        ps.rank_signal AS rankSignal
      FROM paper_topics pt
      JOIN paper_search ps ON ps.node_id = pt.node_id
      WHERE LOWER(pt.topic) LIKE LOWER(?)
        AND ps.publication_year IS NOT NULL
      ORDER BY ps.publication_year ASC, COALESCE(ps.rank_signal, 0) DESC, ps.title ASC`
    )
      .bind(like)
      .all<{
        year: number;
        nodeId: string;
        title: string;
        doiNorm: string | null;
        rankSignal: number | null;
      }>();

    const topPerYearMap = new Map<number, { nodeId: string; title: string; doiNorm: string | null; rankSignal: number | null }[]>();
    for (const row of topRowsResult.results ?? []) {
      const current = topPerYearMap.get(row.year) ?? [];
      if (current.length < topPerYear) {
        current.push({
          nodeId: row.nodeId,
          title: row.title,
          doiNorm: row.doiNorm,
          rankSignal: row.rankSignal
        });
      }
      topPerYearMap.set(row.year, current);
    }

    const items = (yearlyResult.results ?? []).map((row) => ({
      year: row.year,
      paper_count: row.paperCount,
      total_rank_signal: row.totalRankSignal,
      top_papers: topPerYearMap.get(row.year) ?? []
    }));

    return c.json({
      ok: true,
      query: topicName,
      items
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Topic evolution failed";
    return jsonError(c, 500, "TOPIC_EVOLUTION_FAILED", message);
  }
});

app.get("/api/topics/:name/papers", async (c) => {
  const topicName = decodeURIComponent(c.req.param("name")).trim();
  if (topicName.length < 2) {
    return jsonError(c, 400, "INVALID_TOPIC", "topic name must be at least 2 characters");
  }
  const like = `%${topicName}%`;
  const limit = parsePositiveInt(c.req.query("limit"), 20, 100);

  try {
    const result = await c.env.DB.prepare(
      `SELECT
        ps.node_id AS nodeId,
        ps.title AS title,
        ps.doi_norm AS doiNorm,
        ps.publication_year AS publicationYear,
        ps.venue AS venue,
        ps.rank_signal AS rankSignal,
        pt.topic AS topic,
        pt.score AS topicScore
      FROM paper_topics pt
      JOIN paper_search ps ON ps.node_id = pt.node_id
      WHERE LOWER(pt.topic) LIKE LOWER(?)
      ORDER BY COALESCE(ps.rank_signal, 0) DESC, COALESCE(ps.publication_year, 0) DESC
      LIMIT ?`
    )
      .bind(like, limit)
      .all<{
        nodeId: string;
        title: string;
        doiNorm: string | null;
        publicationYear: number | null;
        venue: string | null;
        rankSignal: number | null;
        topic: string;
        topicScore: number | null;
      }>();

    return c.json({
      ok: true,
      query: topicName,
      items: result.results ?? []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Topic papers query failed";
    return jsonError(c, 500, "TOPIC_PAPERS_FAILED", message);
  }
});

app.get("/api/recommend", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  const limit = parsePositiveInt(c.req.query("limit"), 20, 50);
  const seedLimit = parsePositiveInt(c.req.query("seed_limit"), 20, 40);
  const candidateLimit = parsePositiveInt(c.req.query("candidate_limit"), 100, 150);

  try {
    const libraryResult = await c.env.DB.prepare(
      `SELECT ul.node_id AS nodeId
      FROM user_library ul
      WHERE ul.user_id = ? AND ul.status = 'saved'
      ORDER BY COALESCE(ul.last_opened_at, ul.added_at) DESC
      LIMIT ?`
    )
      .bind(user.userId, seedLimit)
      .all<{ nodeId: string }>();

    const seedIds = (libraryResult.results ?? []).map((row) => row.nodeId);
    if (seedIds.length === 0) {
      return jsonError(c, 404, "NO_LIBRARY_SEED", "User library has no saved papers");
    }

    const seedSet = new Set(seedIds);
    const semanticRanks = new Map<string, number>();
    const graphRanks = new Map<string, number>();

    const vectorIndex = c.env.PAPER_VECTORS as unknown as {
      getByIds?: (ids: string[]) => Promise<unknown>;
      query?: (
        vector: number[],
        options: { topK: number; returnValues?: boolean; returnMetadata?: boolean }
      ) => Promise<unknown>;
    };

    if (typeof vectorIndex.getByIds === "function" && typeof vectorIndex.query === "function") {
      try {
        const rawVectors = await vectorIndex.getByIds(seedIds);
        const vectorEntries = parseVectorEntries(
          isRecord(rawVectors) && Array.isArray(rawVectors.vectors) ? rawVectors.vectors : rawVectors
        );
        const centroid = meanVector(vectorEntries.map((entry) => entry.values));
        if (centroid) {
          const queryResult = await vectorIndex.query(centroid, {
            topK: Math.min(candidateLimit, VECTORIZE_MAX_TOP_K),
            returnValues: false,
            returnMetadata: false
          });
          const semanticMatches = parseVectorMatches(queryResult);
          let rank = 1;
          for (const match of semanticMatches) {
            if (seedSet.has(match.id) || semanticRanks.has(match.id)) {
              continue;
            }
            semanticRanks.set(match.id, rank);
            rank += 1;
          }
        }
      } catch {
        // Semantic branch is optional; recommendation still proceeds with graph-only candidates.
      }
    }

    const placeholders = seedIds.map(() => "?").join(", ");
    const graphResult = await c.env.DB.prepare(
      `SELECT
        CASE
          WHEN e.from_node_id IN (${placeholders}) THEN e.to_node_id
          ELSE e.from_node_id
        END AS nodeId,
        COUNT(*) AS edgeCount
      FROM cite_edges e
      WHERE e.from_node_id IN (${placeholders}) OR e.to_node_id IN (${placeholders})
      GROUP BY nodeId
      ORDER BY edgeCount DESC
      LIMIT ?`
    )
      .bind(...seedIds, ...seedIds, candidateLimit)
      .all<{ nodeId: string; edgeCount: number }>();

    let graphRank = 1;
    for (const row of graphResult.results ?? []) {
      if (seedSet.has(row.nodeId) || graphRanks.has(row.nodeId)) {
        continue;
      }
      graphRanks.set(row.nodeId, graphRank);
      graphRank += 1;
    }

    const candidateMap = new Map<
      string,
      { nodeId: string; score: number; reasons: Set<string>; semanticRank: number | null; graphRank: number | null }
    >();
    for (const [nodeId, rank] of semanticRanks) {
      candidateMap.set(nodeId, {
        nodeId,
        score: 1 / (RRF_K + rank),
        reasons: new Set(["semantic_similar"]),
        semanticRank: rank,
        graphRank: null
      });
    }
    for (const [nodeId, rank] of graphRanks) {
      const existing = candidateMap.get(nodeId);
      const increment = 0.7 * (1 / (RRF_K + rank));
      if (!existing) {
        candidateMap.set(nodeId, {
          nodeId,
          score: increment,
          reasons: new Set(["graph_neighbor"]),
          semanticRank: null,
          graphRank: rank
        });
      } else {
        existing.score += increment;
        existing.reasons.add("graph_neighbor");
        existing.graphRank = rank;
      }
    }

    const rankedCandidates = Array.from(candidateMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, candidateLimit);

    if (rankedCandidates.length === 0) {
      return c.json({
        ok: true,
        user_id: user.userId,
        seeds: seedIds,
        items: []
      });
    }

    const candidateIds = rankedCandidates.map((candidate) => candidate.nodeId);
    const candidatePlaceholders = candidateIds.map(() => "?").join(", ");
    const paperRows = await c.env.DB.prepare(
      `SELECT
        ps.node_id AS nodeId,
        ps.title AS title,
        ps.doi_norm AS doiNorm,
        ps.authors_text AS authorsText,
        ps.publication_year AS publicationYear,
        ps.venue AS venue,
        ps.rank_signal AS rankSignal
      FROM paper_search ps
      WHERE ps.node_id IN (${candidatePlaceholders})`
    )
      .bind(...candidateIds)
      .all<{
        nodeId: string;
        title: string;
        doiNorm: string | null;
        authorsText: string | null;
        publicationYear: number | null;
        venue: string | null;
        rankSignal: number | null;
      }>();
    const paperMap = new Map((paperRows.results ?? []).map((row) => [row.nodeId, row]));

    const items = rankedCandidates
      .map((candidate) => {
        const paper = paperMap.get(candidate.nodeId);
        if (!paper) {
          return null;
        }
        const reasons = Array.from(candidate.reasons.values());
        return {
          nodeId: paper.nodeId,
          doiNorm: paper.doiNorm,
          title: paper.title,
          authorsText: paper.authorsText,
          publicationYear: paper.publicationYear,
          venue: paper.venue,
          rankSignal: paper.rankSignal ?? 0,
          score: Number(candidate.score.toFixed(8)),
          reason: reasons.includes("semantic_similar") ? "semantic_similar" : "graph_neighbor",
          reasons,
          semanticRank: candidate.semanticRank,
          graphRank: candidate.graphRank
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.rankSignal - a.rankSignal;
      })
      .slice(0, limit);

    return c.json({
      ok: true,
      user_id: user.userId,
      seeds: seedIds,
      ranking: {
        algorithm: "weighted_rrf",
        semantic_weight: 1,
        graph_weight: 0.7,
        k: RRF_K
      },
      items
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recommendation query failed";
    return jsonError(c, 500, "RECOMMEND_FAILED", message);
  }
});

app.get("/api/user/interests", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const limit = parsePositiveInt(c.req.query("limit"), 50, 200);

  try {
    const result = await c.env.DB.prepare(
      `SELECT topic, weight, updated_at
      FROM user_interests
      WHERE user_id = ?
      ORDER BY weight DESC, updated_at DESC
      LIMIT ?`
    )
      .bind(user.userId, limit)
      .all<{ topic: string; weight: number; updated_at: number }>();
    return c.json({
      ok: true,
      user_id: user.userId,
      items: result.results ?? []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "User interests query failed";
    return jsonError(c, 500, "USER_INTERESTS_FAILED", message);
  }
});

app.put("/api/user/interests", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body) || !Array.isArray(body.topics)) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "payload requires topics[]");
  }

  const deduped = new Map<string, { topic: string; weight: number }>();
  for (const entry of body.topics) {
    if (typeof entry === "string") {
      const topic = toOptionalString(entry);
      if (!topic) {
        continue;
      }
      const key = topic.toLowerCase();
      const existing = deduped.get(key);
      if (!existing || existing.weight < 1) {
        deduped.set(key, { topic, weight: 1 });
      }
      continue;
    }
    if (!isRecord(entry)) {
      continue;
    }
    const topic = toOptionalString(entry.topic);
    if (!topic) {
      continue;
    }
    const parsedWeight = toOptionalNumber(entry.weight);
    const weight = parsedWeight === null ? 1 : Math.max(0, parsedWeight);
    const key = topic.toLowerCase();
    const existing = deduped.get(key);
    if (!existing || existing.weight < weight) {
      deduped.set(key, { topic, weight });
    }
  }

  const topics = Array.from(deduped.values()).filter((entry) => entry.topic.length > 0);
  if (topics.length === 0) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "topics[] must include at least one valid topic");
  }

  const now = nowUnixSeconds();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("DELETE FROM user_interests WHERE user_id = ?").bind(user.userId)
  ];
  const rows = topics.map((entry) => [user.userId, entry.topic, entry.weight, now]);
  for (const chunk of chunkRows(rows, 4)) {
    const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO user_interests (user_id, topic, weight, updated_at)
        VALUES ${placeholders}`
      ).bind(...chunk.flat())
    );
  }

  try {
    await c.env.DB.batch(statements);
    return c.json({
      ok: true,
      user_id: user.userId,
      updated: topics.length,
      items: topics.sort((a, b) => b.weight - a.weight)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "User interests update failed";
    return jsonError(c, 500, "USER_INTERESTS_UPDATE_FAILED", message);
  }
});

app.get("/api/feed", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  const limit = parsePositiveInt(c.req.query("limit"), 20, 100);
  const unreadOnly = (c.req.query("unread") ?? "").trim().toLowerCase() === "true";

  try {
    const result = await c.env.DB.prepare(
      `SELECT
        fi.id AS id,
        fi.node_id AS nodeId,
        fi.reason_code AS reasonCode,
        fi.score AS score,
        fi.event_ts AS eventTs,
        fi.seen_at AS seenAt,
        fi.clicked_at AS clickedAt,
        ps.doi_norm AS doiNorm,
        COALESCE(ps.title, cn.title) AS title,
        ps.authors_text AS authorsText,
        ps.publication_year AS publicationYear,
        ps.venue AS venue
      FROM feed_items fi
      JOIN cite_nodes cn ON cn.id = fi.node_id
      LEFT JOIN paper_search ps ON ps.node_id = fi.node_id
      WHERE fi.user_id = ?
        AND (? = 0 OR fi.seen_at IS NULL)
      ORDER BY COALESCE(fi.score, 0) DESC, fi.event_ts DESC
      LIMIT ?`
    )
      .bind(user.userId, unreadOnly ? 1 : 0, limit)
      .all<{
        id: string;
        nodeId: string;
        reasonCode: string;
        score: number | null;
        eventTs: number;
        seenAt: number | null;
        clickedAt: number | null;
        doiNorm: string | null;
        title: string;
        authorsText: string | null;
        publicationYear: number | null;
        venue: string | null;
      }>();

    return c.json({
      ok: true,
      user_id: user.userId,
      unread_only: unreadOnly,
      items: result.results ?? []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Feed query failed";
    return jsonError(c, 500, "FEED_QUERY_FAILED", message);
  }
});

app.patch("/api/feed/:id/seen", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  const feedId = toOptionalString(c.req.param("id"));
  if (!feedId) {
    return jsonError(c, 400, "INVALID_FEED_ID", "feed id path parameter is required");
  }

  const now = nowUnixSeconds();
  try {
    const updateResult = await c.env.DB.prepare(
      `UPDATE feed_items
      SET seen_at = COALESCE(seen_at, ?)
      WHERE id = ? AND user_id = ?`
    )
      .bind(now, feedId, user.userId)
      .run<D1ChangeMeta>();

    const changes = updateResult.meta?.changes ?? 0;
    if (changes === 0) {
      return jsonError(c, 404, "FEED_ITEM_NOT_FOUND", "feed item not found for user");
    }

    return c.json({ ok: true, id: feedId, seen_at: now });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Feed update failed";
    return jsonError(c, 500, "FEED_UPDATE_FAILED", message);
  }
});

app.post("/api/annotations", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body)) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be an object");
  }

  const doiNorm = normalizeDoiForStorage(toOptionalString(body.doi) ?? "");
  if (!doiNorm) {
    return jsonError(c, 400, "INVALID_DOI", "doi is required and must be valid");
  }
  const page = toOptionalNumber(body.page);
  if (page === null || page < 1) {
    return jsonError(c, 400, "INVALID_PAGE", "page must be a positive number");
  }
  const rect = parseNormalizedRect(body.normRect ?? body);
  if (!rect) {
    return jsonError(
      c,
      400,
      "INVALID_RECT",
      "normRect (or norm_x/norm_y/norm_w/norm_h) is required and must be normalized"
    );
  }

  const color = toOptionalString(body.color) ?? "yellow";
  const note = toOptionalString(body.note);
  const payloadJson = buildAnnotationPayloadJson(note);

  try {
    const nodeId = await resolveNodeIdByDoi(c, doiNorm);
    if (!nodeId) {
      return jsonError(c, 404, "DOI_NOT_FOUND", "No paper node found for this DOI");
    }
    const id = makeId("ann");
    const now = nowUnixSeconds();
    await c.env.DB.prepare(
      `INSERT INTO annotations (
        id, user_id, node_id, page, x, y, width, height, color, kind, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'highlight', ?, ?, ?)`
    )
      .bind(
        id,
        user.userId,
        nodeId,
        Math.trunc(page),
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        color,
        payloadJson,
        now,
        now
      )
      .run();

    return c.json({
      ok: true,
      item: {
        id,
        doi: doiNorm,
        page: Math.trunc(page),
        norm_x: rect.x,
        norm_y: rect.y,
        norm_w: rect.width,
        norm_h: rect.height,
        color,
        note,
        created_at: now,
        updated_at: now
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Annotation create failed";
    return jsonError(c, 500, "ANNOTATION_CREATE_FAILED", message);
  }
});

app.get("/api/annotations", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  const doiNorm = normalizeDoiForStorage(c.req.query("doi") ?? "");
  if (!doiNorm) {
    return jsonError(c, 400, "INVALID_DOI", "doi query parameter is required and must be valid");
  }

  const rawPage = c.req.query("page");
  const page = parseOptionalIntegerParam(rawPage);
  if (rawPage && (page === null || page < 1)) {
    return jsonError(c, 400, "INVALID_PAGE", "page must be a positive integer");
  }

  try {
    const nodeId = await resolveNodeIdByDoi(c, doiNorm);
    if (!nodeId) {
      return c.json({ ok: true, items: [] });
    }

    const baseSql = `SELECT
      id, user_id, node_id, page, x, y, width, height, color, payload_json, created_at, updated_at
    FROM annotations
    WHERE user_id = ? AND node_id = ?`;

    const result = page === null
      ? await c.env.DB.prepare(`${baseSql} ORDER BY updated_at DESC`).bind(user.userId, nodeId).all<AnnotationRecord>()
      : await c.env.DB.prepare(`${baseSql} AND page = ? ORDER BY updated_at DESC`)
        .bind(user.userId, nodeId, page)
        .all<AnnotationRecord>();

    const items = (result.results ?? []).map((row) => ({
      id: row.id,
      doi: doiNorm,
      page: row.page,
      norm_x: row.x,
      norm_y: row.y,
      norm_w: row.width,
      norm_h: row.height,
      color: row.color,
      note: parseBodyNote(row.payload_json),
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    return c.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Annotation list failed";
    return jsonError(c, 500, "ANNOTATION_LIST_FAILED", message);
  }
});

app.patch("/api/annotations/:id", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  const annotationId = toOptionalString(c.req.param("id"));
  if (!annotationId) {
    return jsonError(c, 400, "INVALID_ID", "annotation id is required");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body)) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be an object");
  }

  let rect;
  try {
    rect = parseOptionalNormalizedRect(body.normRect ?? body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid rectangle payload";
    return jsonError(c, 400, "INVALID_RECT", message);
  }

  const color = toOptionalString(body.color);
  const note = Object.prototype.hasOwnProperty.call(body, "note")
    ? toOptionalString(body.note)
    : null;
  const rawPage = Object.prototype.hasOwnProperty.call(body, "page")
    ? toOptionalNumber(body.page)
    : null;
  if (Object.prototype.hasOwnProperty.call(body, "page") && (rawPage === null || rawPage < 1)) {
    return jsonError(c, 400, "INVALID_PAGE", "page must be a positive number");
  }

  try {
    const existing = await c.env.DB.prepare(
      `SELECT
        a.id,
        a.user_id,
        a.node_id,
        a.page,
        a.x,
        a.y,
        a.width,
        a.height,
        a.color,
        a.payload_json,
        a.created_at,
        a.updated_at,
        n.doi_norm AS doi_norm
      FROM annotations a
      JOIN cite_nodes n ON n.id = a.node_id
      WHERE a.id = ? AND a.user_id = ?
      LIMIT 1`
    )
      .bind(annotationId, user.userId)
      .first<AnnotationRecord & { doi_norm: string | null }>();

    if (!existing) {
      return jsonError(c, 404, "ANNOTATION_NOT_FOUND", "annotation not found");
    }

    const resolvedNote = Object.prototype.hasOwnProperty.call(body, "note")
      ? note
      : parseBodyNote(existing.payload_json);
    const now = nowUnixSeconds();
    await c.env.DB.prepare(
      `UPDATE annotations
      SET
        page = ?,
        x = ?,
        y = ?,
        width = ?,
        height = ?,
        color = ?,
        payload_json = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?`
    )
      .bind(
        rawPage !== null ? Math.trunc(rawPage) : existing.page,
        rect.x ?? existing.x,
        rect.y ?? existing.y,
        rect.width ?? existing.width,
        rect.height ?? existing.height,
        color ?? existing.color,
        buildAnnotationPayloadJson(resolvedNote),
        now,
        annotationId,
        user.userId
      )
      .run();

    return c.json({
      ok: true,
      item: {
        id: existing.id,
        doi: existing.doi_norm,
        page: rawPage !== null ? Math.trunc(rawPage) : existing.page,
        norm_x: rect.x ?? existing.x,
        norm_y: rect.y ?? existing.y,
        norm_w: rect.width ?? existing.width,
        norm_h: rect.height ?? existing.height,
        color: color ?? existing.color,
        note: resolvedNote,
        created_at: existing.created_at,
        updated_at: now
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Annotation update failed";
    return jsonError(c, 500, "ANNOTATION_UPDATE_FAILED", message);
  }
});

app.delete("/api/annotations/:id", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const annotationId = toOptionalString(c.req.param("id"));
  if (!annotationId) {
    return jsonError(c, 400, "INVALID_ID", "annotation id is required");
  }

  try {
    const result = await c.env.DB.prepare("DELETE FROM annotations WHERE id = ? AND user_id = ?")
      .bind(annotationId, user.userId)
      .run();
    const changes = ((result.meta as D1ChangeMeta | undefined)?.changes ?? 0);
    if (changes === 0) {
      return jsonError(c, 404, "ANNOTATION_NOT_FOUND", "annotation not found");
    }
    return c.json({ ok: true, deleted: annotationId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Annotation delete failed";
    return jsonError(c, 500, "ANNOTATION_DELETE_FAILED", message);
  }
});

app.post("/api/sessions/update", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body)) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be an object");
  }

  const doiNorm = normalizeDoiForStorage(toOptionalString(body.doi) ?? "");
  if (!doiNorm) {
    return jsonError(c, 400, "INVALID_DOI", "doi is required and must be valid");
  }
  const lastPage = toOptionalNumber(body.last_page);
  if (lastPage === null || lastPage < 1) {
    return jsonError(c, 400, "INVALID_LAST_PAGE", "last_page must be a positive number");
  }
  const scrollY = toOptionalNumber(body.scroll_y);
  if (scrollY !== null && (scrollY < 0 || scrollY > 1)) {
    return jsonError(c, 400, "INVALID_SCROLL_Y", "scroll_y must be between 0 and 1");
  }
  const deltaSeconds = Math.max(0, toOptionalNumber(body.delta_seconds) ?? 0);

  try {
    const nodeId = await resolveNodeIdByDoi(c, doiNorm);
    if (!nodeId) {
      return jsonError(c, 404, "DOI_NOT_FOUND", "No paper node found for this DOI");
    }

    const sessionId = `rs_${user.userId}_${nodeId}`;
    const existing = await c.env.DB.prepare(
      "SELECT id, started_at, dwell_ms FROM reading_sessions WHERE id = ? LIMIT 1"
    )
      .bind(sessionId)
      .first<{ id: string; started_at: number; dwell_ms: number | null }>();

    const now = nowUnixSeconds();
    const startedAt = existing?.started_at ?? now;
    const accumulatedDwellMs = (existing?.dwell_ms ?? 0) + Math.round(deltaSeconds * 1000);
    const progressRatio = scrollY ?? null;

    await c.env.DB.prepare(
      `INSERT INTO reading_sessions (
        id, user_id, node_id, started_at, ended_at, dwell_ms, last_page, progress_ratio, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ended_at = excluded.ended_at,
        dwell_ms = excluded.dwell_ms,
        last_page = excluded.last_page,
        progress_ratio = excluded.progress_ratio`
    )
      .bind(
        sessionId,
        user.userId,
        nodeId,
        startedAt,
        now,
        accumulatedDwellMs,
        Math.trunc(lastPage),
        progressRatio,
        startedAt
      )
      .run();

    return c.json({
      ok: true,
      item: {
        id: sessionId,
        doi: doiNorm,
        last_page: Math.trunc(lastPage),
        scroll_y: progressRatio,
        total_seconds: Math.floor(accumulatedDwellMs / 1000),
        last_seen_at: now
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Session update failed";
    return jsonError(c, 500, "SESSION_UPDATE_FAILED", message);
  }
});

app.get("/api/sessions/latest", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const limit = parsePositiveInt(c.req.query("limit"), 5, 20);

  try {
    const result = await c.env.DB.prepare(
      `SELECT
        rs.id AS id,
        rs.last_page AS last_page,
        rs.progress_ratio AS progress_ratio,
        rs.dwell_ms AS dwell_ms,
        rs.started_at AS started_at,
        rs.ended_at AS ended_at,
        cn.id AS node_id,
        cn.doi_norm AS doi_norm,
        cn.title AS title
      FROM reading_sessions rs
      JOIN cite_nodes cn ON cn.id = rs.node_id
      WHERE rs.user_id = ?
      ORDER BY COALESCE(rs.ended_at, rs.started_at) DESC
      LIMIT ?`
    )
      .bind(user.userId, limit)
      .all<{
        id: string;
        last_page: number | null;
        progress_ratio: number | null;
        dwell_ms: number | null;
        started_at: number;
        ended_at: number | null;
        node_id: string;
        doi_norm: string | null;
        title: string;
      }>();

    const items = (result.results ?? []).map((row) => ({
      id: row.id,
      doi: row.doi_norm,
      title: row.title,
      last_page: row.last_page,
      scroll_y: row.progress_ratio,
      total_seconds: Math.floor((row.dwell_ms ?? 0) / 1000),
      last_seen_at: row.ended_at ?? row.started_at
    }));

    return c.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Latest sessions query failed";
    return jsonError(c, 500, "SESSIONS_LATEST_FAILED", message);
  }
});

app.delete("/api/user/me", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  try {
    const collectionRows = await c.env.DB.prepare(
      "SELECT id FROM user_collections WHERE user_id = ? LIMIT 1000"
    )
      .bind(user.userId)
      .all<{ id: string }>();
    const collectionIds = (collectionRows.results ?? []).map((row) => row.id);

    const deleteResult: Record<string, number> = {};
    const runDelete = async (key: string, sql: string, binds: (string | number | null)[]) => {
      const result = await c.env.DB.prepare(sql).bind(...binds).run();
      deleteResult[key] = ((result.meta as D1ChangeMeta | undefined)?.changes ?? 0);
    };

    if (collectionIds.length > 0) {
      const placeholders = collectionIds.map(() => "?").join(", ");
      await runDelete(
        "collection_papers",
        `DELETE FROM collection_papers WHERE collection_id IN (${placeholders})`,
        collectionIds
      );
    } else {
      deleteResult.collection_papers = 0;
    }

    await runDelete("annotations", "DELETE FROM annotations WHERE user_id = ?", [user.userId]);
    await runDelete("user_library", "DELETE FROM user_library WHERE user_id = ?", [user.userId]);
    await runDelete("reading_sessions", "DELETE FROM reading_sessions WHERE user_id = ?", [user.userId]);
    await runDelete("user_collections", "DELETE FROM user_collections WHERE user_id = ?", [user.userId]);
    await runDelete("saved_searches", "DELETE FROM saved_searches WHERE user_id = ?", [user.userId]);
    await runDelete("notifications", "DELETE FROM notifications WHERE user_id = ?", [user.userId]);
    await runDelete("feed_items", "DELETE FROM feed_items WHERE user_id = ?", [user.userId]);
    await runDelete("user_interests", "DELETE FROM user_interests WHERE user_id = ?", [user.userId]);

    return c.json({
      ok: true,
      deleted: {
        user_id: user.userId,
        ...deleteResult
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account delete failed";
    return jsonError(c, 500, "ACCOUNT_DELETE_FAILED", message);
  }
});

app.post("/api/saved-searches", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body)) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be an object");
  }

  const name = toOptionalString(body.name) ?? "Saved search";
  const queryValue = body.query;
  const query = typeof queryValue === "string"
    ? toOptionalString(queryValue)
    : queryValue !== undefined
      ? JSON.stringify(queryValue)
      : null;
  if (!query) {
    return jsonError(c, 400, "INVALID_QUERY", "query is required");
  }
  const filters = isRecord(body.filters) ? body.filters : null;
  const id = toOptionalString(body.id) ?? makeId("ss");
  const queryHash = makeQueryHash(query);
  const now = nowUnixSeconds();
  const storedPayload = JSON.stringify({
    name,
    query,
    filters
  });

  try {
    await c.env.DB.prepare(
      `INSERT INTO saved_searches (id, user_id, query_hash, filters_json, created_at, last_run_at)
      VALUES (?, ?, ?, ?, ?, NULL)`
    )
      .bind(id, user.userId, queryHash, storedPayload, now)
      .run();

    return c.json({
      ok: true,
      item: {
        id,
        name,
        query,
        query_hash: queryHash,
        filters,
        created_at: now,
        last_run_at: null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Saved search create failed";
    return jsonError(c, 500, "SAVED_SEARCH_CREATE_FAILED", message);
  }
});

app.get("/api/saved-searches", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const limit = parsePositiveInt(c.req.query("limit"), 20, 100);

  try {
    const result = await c.env.DB.prepare(
      `SELECT id, query_hash, filters_json, created_at, last_run_at
      FROM saved_searches
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?`
    )
      .bind(user.userId, limit)
      .all<SavedSearchRecord>();

    const items = (result.results ?? []).map((row) => {
      let parsedFilters: Record<string, unknown> = {};
      try {
        const parsed = row.filters_json ? JSON.parse(row.filters_json) : {};
        if (isRecord(parsed)) {
          parsedFilters = parsed;
        }
      } catch {
        parsedFilters = {};
      }
      return {
        id: row.id,
        name: toOptionalString(parsedFilters.name) ?? "Saved search",
        query: parsedFilters.query ?? null,
        query_hash: row.query_hash,
        filters: isRecord(parsedFilters.filters) ? parsedFilters.filters : null,
        created_at: row.created_at,
        last_run_at: row.last_run_at
      };
    });

    return c.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Saved search list failed";
    return jsonError(c, 500, "SAVED_SEARCH_LIST_FAILED", message);
  }
});

app.delete("/api/saved-searches/:id", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const savedSearchId = toOptionalString(c.req.param("id"));
  if (!savedSearchId) {
    return jsonError(c, 400, "INVALID_ID", "saved search id is required");
  }

  try {
    const result = await c.env.DB.prepare("DELETE FROM saved_searches WHERE id = ? AND user_id = ?")
      .bind(savedSearchId, user.userId)
      .run();
    const changes = ((result.meta as D1ChangeMeta | undefined)?.changes ?? 0);
    if (changes === 0) {
      return jsonError(c, 404, "SAVED_SEARCH_NOT_FOUND", "saved search not found");
    }
    return c.json({ ok: true, deleted: savedSearchId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Saved search delete failed";
    return jsonError(c, 500, "SAVED_SEARCH_DELETE_FAILED", message);
  }
});

app.get("/api/notifications", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const unreadOnly = (c.req.query("unread") ?? "").trim().toLowerCase() === "true";
  const limit = parsePositiveInt(c.req.query("limit"), 20, 100);

  try {
    const sql = unreadOnly
      ? `SELECT id, channel, type, payload_json, created_at, read_at
         FROM notifications
         WHERE user_id = ? AND read_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?`
      : `SELECT id, channel, type, payload_json, created_at, read_at
         FROM notifications
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`;
    const result = await c.env.DB.prepare(sql).bind(user.userId, limit).all<NotificationRecord>();

    const items = (result.results ?? []).map((row) => {
      let payload: unknown = null;
      try {
        payload = row.payload_json ? JSON.parse(row.payload_json) : null;
      } catch {
        payload = null;
      }
      return {
        id: row.id,
        channel: row.channel,
        type: row.type,
        payload,
        created_at: row.created_at,
        read_at: row.read_at
      };
    });
    return c.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notifications query failed";
    return jsonError(c, 500, "NOTIFICATIONS_LIST_FAILED", message);
  }
});

app.patch("/api/notifications/:id/read", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const notificationId = toOptionalString(c.req.param("id"));
  if (!notificationId) {
    return jsonError(c, 400, "INVALID_ID", "notification id is required");
  }

  try {
    const now = nowUnixSeconds();
    const result = await c.env.DB.prepare(
      `UPDATE notifications
      SET read_at = COALESCE(read_at, ?)
      WHERE id = ? AND user_id = ?`
    )
      .bind(now, notificationId, user.userId)
      .run();
    const changes = ((result.meta as D1ChangeMeta | undefined)?.changes ?? 0);
    if (changes === 0) {
      return jsonError(c, 404, "NOTIFICATION_NOT_FOUND", "notification not found");
    }
    return c.json({ ok: true, id: notificationId, read_at: now });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notification read update failed";
    return jsonError(c, 500, "NOTIFICATION_UPDATE_FAILED", message);
  }
});

app.post("/api/collections", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body)) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be an object");
  }

  const name = toOptionalString(body.name);
  if (!name) {
    return jsonError(c, 400, "INVALID_NAME", "name is required");
  }
  const description = toOptionalString(body.description);
  const collectionId = toOptionalString(body.id) ?? makeId("col");
  const now = nowUnixSeconds();

  try {
    await c.env.DB.prepare(
      `INSERT INTO user_collections (id, user_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(collectionId, user.userId, name, description, now, now)
      .run();
    return c.json({
      ok: true,
      item: {
        id: collectionId,
        user_id: user.userId,
        name,
        description,
        created_at: now,
        updated_at: now
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Collection create failed";
    return jsonError(c, 500, "COLLECTION_CREATE_FAILED", message);
  }
});

app.get("/api/collections", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const limit = parsePositiveInt(c.req.query("limit"), 100, 200);

  try {
    const result = await c.env.DB.prepare(
      `SELECT
        uc.id AS id,
        uc.name AS name,
        uc.description AS description,
        uc.created_at AS created_at,
        uc.updated_at AS updated_at,
        COUNT(cp.node_id) AS paper_count
      FROM user_collections uc
      LEFT JOIN collection_papers cp ON cp.collection_id = uc.id
      WHERE uc.user_id = ?
      GROUP BY uc.id
      ORDER BY uc.updated_at DESC, uc.created_at DESC
      LIMIT ?`
    )
      .bind(user.userId, limit)
      .all<{
        id: string;
        name: string;
        description: string | null;
        created_at: number;
        updated_at: number;
        paper_count: number;
      }>();

    return c.json({
      ok: true,
      user_id: user.userId,
      items: result.results ?? []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Collection list failed";
    return jsonError(c, 500, "COLLECTION_LIST_FAILED", message);
  }
});

app.patch("/api/collections/:id", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const collectionId = toOptionalString(c.req.param("id"));
  if (!collectionId) {
    return jsonError(c, 400, "INVALID_ID", "collection id is required");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body)) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be an object");
  }

  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");
  if (!hasName && !hasDescription) {
    return jsonError(c, 400, "EMPTY_PATCH", "name or description must be provided");
  }

  const nextName = hasName ? toOptionalString(body.name) : null;
  if (hasName && !nextName) {
    return jsonError(c, 400, "INVALID_NAME", "name must be a non-empty string");
  }
  const nextDescription = hasDescription
    ? body.description === null
      ? null
      : toOptionalString(body.description)
    : null;
  if (hasDescription && body.description !== null && typeof body.description !== "string") {
    return jsonError(c, 400, "INVALID_DESCRIPTION", "description must be a string or null");
  }

  try {
    const existing = await c.env.DB.prepare(
      `SELECT id, name, description, created_at, updated_at
      FROM user_collections
      WHERE id = ? AND user_id = ?
      LIMIT 1`
    )
      .bind(collectionId, user.userId)
      .first<{ id: string; name: string; description: string | null; created_at: number; updated_at: number }>();
    if (!existing) {
      return jsonError(c, 404, "COLLECTION_NOT_FOUND", "collection not found");
    }

    const name = hasName ? nextName : existing.name;
    const description = hasDescription ? nextDescription : existing.description;
    const updatedAt = nowUnixSeconds();
    await c.env.DB.prepare(
      `UPDATE user_collections
      SET name = ?, description = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`
    )
      .bind(name, description, updatedAt, collectionId, user.userId)
      .run();

    return c.json({
      ok: true,
      item: {
        id: existing.id,
        name,
        description,
        created_at: existing.created_at,
        updated_at: updatedAt
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Collection patch failed";
    return jsonError(c, 500, "COLLECTION_PATCH_FAILED", message);
  }
});

app.delete("/api/collections/:id", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const collectionId = toOptionalString(c.req.param("id"));
  if (!collectionId) {
    return jsonError(c, 400, "INVALID_ID", "collection id is required");
  }

  try {
    const result = await c.env.DB.prepare("DELETE FROM user_collections WHERE id = ? AND user_id = ?")
      .bind(collectionId, user.userId)
      .run();
    const changes = ((result.meta as D1ChangeMeta | undefined)?.changes ?? 0);
    if (changes === 0) {
      return jsonError(c, 404, "COLLECTION_NOT_FOUND", "collection not found");
    }
    return c.json({ ok: true, deleted: collectionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Collection delete failed";
    return jsonError(c, 500, "COLLECTION_DELETE_FAILED", message);
  }
});

app.post("/api/collections/:id/papers", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const collectionId = toOptionalString(c.req.param("id"));
  if (!collectionId) {
    return jsonError(c, 400, "INVALID_ID", "collection id is required");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON");
  }
  if (!isRecord(body)) {
    return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be an object");
  }

  const doiNorm = normalizeDoiForStorage(toOptionalString(body.doi) ?? "");
  if (!doiNorm) {
    return jsonError(c, 400, "INVALID_DOI", "doi is required and must be valid");
  }

  try {
    const collection = await c.env.DB.prepare(
      "SELECT id FROM user_collections WHERE id = ? AND user_id = ? LIMIT 1"
    )
      .bind(collectionId, user.userId)
      .first<{ id: string }>();
    if (!collection) {
      return jsonError(c, 404, "COLLECTION_NOT_FOUND", "collection not found");
    }

    const nodeId = await resolveNodeIdByDoi(c, doiNorm);
    if (!nodeId) {
      return jsonError(c, 404, "DOI_NOT_FOUND", "No paper node found for this DOI");
    }
    const now = nowUnixSeconds();
    await c.env.DB.prepare(
      `INSERT INTO collection_papers (collection_id, node_id, sort_order, added_at)
      VALUES (
        ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM collection_papers WHERE collection_id = ?), 0), ?
      )
      ON CONFLICT(collection_id, node_id) DO UPDATE SET added_at = excluded.added_at`
    )
      .bind(collectionId, nodeId, collectionId, now)
      .run();

    return c.json({
      ok: true,
      item: {
        collection_id: collectionId,
        node_id: nodeId,
        doi: doiNorm,
        added_at: now
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Collection paper add failed";
    return jsonError(c, 500, "COLLECTION_PAPER_ADD_FAILED", message);
  }
});

app.delete("/api/collections/:id/papers/:doi", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const collectionId = toOptionalString(c.req.param("id"));
  if (!collectionId) {
    return jsonError(c, 400, "INVALID_ID", "collection id is required");
  }
  const doiNorm = normalizeDoiForStorage(decodeURIComponent(c.req.param("doi")));
  if (!doiNorm) {
    return jsonError(c, 400, "INVALID_DOI", "doi path parameter must be valid");
  }

  try {
    const collection = await c.env.DB.prepare(
      "SELECT id FROM user_collections WHERE id = ? AND user_id = ? LIMIT 1"
    )
      .bind(collectionId, user.userId)
      .first<{ id: string }>();
    if (!collection) {
      return jsonError(c, 404, "COLLECTION_NOT_FOUND", "collection not found");
    }

    const nodeId = await resolveNodeIdByDoi(c, doiNorm);
    if (!nodeId) {
      return jsonError(c, 404, "DOI_NOT_FOUND", "No paper node found for this DOI");
    }
    const result = await c.env.DB.prepare(
      "DELETE FROM collection_papers WHERE collection_id = ? AND node_id = ?"
    )
      .bind(collectionId, nodeId)
      .run();
    const changes = ((result.meta as D1ChangeMeta | undefined)?.changes ?? 0);
    if (changes === 0) {
      return jsonError(c, 404, "COLLECTION_PAPER_NOT_FOUND", "paper is not attached to this collection");
    }
    return c.json({ ok: true, deleted: { collection_id: collectionId, doi: doiNorm } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Collection paper delete failed";
    return jsonError(c, 500, "COLLECTION_PAPER_DELETE_FAILED", message);
  }
});

app.get("/api/export/library", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }
  const format = parseExportFormat(c.req.query("format"));
  if (!format) {
    return jsonError(c, 400, "INVALID_FORMAT", "format must be one of: bibtex, ris, json");
  }

  try {
    const result = await c.env.DB.prepare(
      `SELECT
        ul.node_id AS nodeId,
        cn.doi_norm AS doiNorm,
        COALESCE(ps.title, cn.title) AS title,
        ps.authors_text AS authorsText,
        COALESCE(ps.publication_year, cn.publication_year) AS publicationYear,
        COALESCE(ps.venue, cn.venue) AS venue,
        cn.source_ref AS sourceRef
      FROM user_library ul
      JOIN cite_nodes cn ON cn.id = ul.node_id
      LEFT JOIN paper_search ps ON ps.node_id = ul.node_id
      WHERE ul.user_id = ?
      ORDER BY COALESCE(ul.last_opened_at, ul.added_at) DESC`
    )
      .bind(user.userId)
      .all<ExportPaperRecord>();

    const items = result.results ?? [];
    return createExportResponse(format, `library-${user.userId}`, items, {
      scope: "library",
      user_id: user.userId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Library export failed";
    return jsonError(c, 500, "LIBRARY_EXPORT_FAILED", message);
  }
});

app.get("/api/export/cite-subgraph", async (c) => {
  const sourceId = toOptionalString(c.req.query("id"));
  if (!sourceId) {
    return jsonError(c, 400, "MISSING_ID", "id query parameter is required");
  }
  const format = parseExportFormat(c.req.query("format"));
  if (!format) {
    return jsonError(c, 400, "INVALID_FORMAT", "format must be one of: bibtex, ris, json");
  }

  try {
    const sourceNode = await c.env.DB.prepare(
      `SELECT
        cn.id AS nodeId,
        cn.doi_norm AS doiNorm,
        COALESCE(ps.title, cn.title) AS title,
        ps.authors_text AS authorsText,
        COALESCE(ps.publication_year, cn.publication_year) AS publicationYear,
        COALESCE(ps.venue, cn.venue) AS venue,
        cn.source_ref AS sourceRef
      FROM cite_nodes cn
      LEFT JOIN paper_search ps ON ps.node_id = cn.id
      WHERE cn.id = ?
      LIMIT 1`
    )
      .bind(sourceId)
      .first<ExportPaperRecord>();
    if (!sourceNode) {
      return jsonError(c, 404, "NODE_NOT_FOUND", "source node not found");
    }

    const neighbors = await c.env.DB.prepare(
      `SELECT
        related.id AS nodeId,
        related.doi_norm AS doiNorm,
        COALESCE(ps.title, related.title) AS title,
        ps.authors_text AS authorsText,
        COALESCE(ps.publication_year, related.publication_year) AS publicationYear,
        COALESCE(ps.venue, related.venue) AS venue,
        related.source_ref AS sourceRef
      FROM cite_edges e
      JOIN cite_nodes related ON related.id = CASE
        WHEN e.from_node_id = ? THEN e.to_node_id
        ELSE e.from_node_id
      END
      LEFT JOIN paper_search ps ON ps.node_id = related.id
      WHERE e.from_node_id = ? OR e.to_node_id = ?`
    )
      .bind(sourceId, sourceId, sourceId)
      .all<ExportPaperRecord>();

    const dedup = new Map<string, ExportPaperRecord>();
    dedup.set(sourceNode.nodeId, sourceNode);
    for (const item of neighbors.results ?? []) {
      dedup.set(item.nodeId, item);
    }
    const items = Array.from(dedup.values());
    return createExportResponse(format, `cite-subgraph-${sourceId}`, items, {
      scope: "cite_subgraph",
      source_id: sourceId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cite subgraph export failed";
    return jsonError(c, 500, "CITE_SUBGRAPH_EXPORT_FAILED", message);
  }
});

function isFormDataFile(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as File).arrayBuffer === "function"
  );
}

async function parseUploadBytes(c: Context<{ Bindings: Env }>): Promise<{
  filename: string | null;
  contentType: string | null;
  bytes: Uint8Array;
}> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const fileEntry = formData.get("file");
    if (!isFormDataFile(fileEntry)) {
      throw new Error("multipart upload requires a file field");
    }
    const buffer = await fileEntry.arrayBuffer();
    return {
      filename: fileEntry.name || null,
      contentType: fileEntry.type || null,
      bytes: new Uint8Array(buffer)
    };
  }

  const payload = await c.req.json();
  if (!isRecord(payload)) {
    throw new Error("JSON upload payload must be an object");
  }
  const contentBase64 = toOptionalString(payload.content_base64 ?? payload.contentBase64);
  if (!contentBase64) {
    throw new Error("JSON upload requires content_base64");
  }
  return {
    filename: toOptionalString(payload.filename),
    contentType: toOptionalString(payload.content_type ?? payload.contentType),
    bytes: decodeBase64Payload(contentBase64)
  };
}

app.post("/api/papers/upload", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  let filename: string | null = null;
  let contentType: string | null = null;
  let bytes: Uint8Array;
  try {
    ({ filename, contentType, bytes } = await parseUploadBytes(c));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid upload payload";
    return jsonError(c, 400, "INVALID_UPLOAD", message);
  }

  if (bytes.byteLength === 0) {
    return jsonError(c, 400, "EMPTY_UPLOAD", "upload payload is empty");
  }
  if (bytes.byteLength > MAX_PDF_UPLOAD_BYTES) {
    return jsonError(
      c,
      413,
      "UPLOAD_TOO_LARGE",
      `upload exceeds ${MAX_PDF_UPLOAD_BYTES} bytes (50 MB limit)`
    );
  }

  const uploadId = makeId("upload");
  const now = nowUnixSeconds();
  const expiresAt = now + PDF_UPLOAD_TTL_SECONDS;
  const storageKey = `paper-uploads/${user.userId}/${uploadId}.pdf`;
  let storageBackend = "d1_metadata";
  let r2Stored = false;

  if (c.env.UPLOADS_BUCKET) {
    try {
      await c.env.UPLOADS_BUCKET.put(storageKey, bytes, {
        httpMetadata: {
          contentType: contentType ?? "application/pdf"
        },
        customMetadata: {
          user_id: user.userId,
          upload_id: uploadId,
          expires_at: String(expiresAt)
        }
      });
      storageBackend = "r2";
      r2Stored = true;
    } catch (error) {
      logStructured(c, "warn", "papers.upload.r2_failed", {
        upload_id: uploadId,
        message: error instanceof Error ? error.message : "R2 put failed"
      });
    }
  }

  const contentHash = await sha256HexFromBytes(bytes);
  const metrics = {
    upload_id: uploadId,
    user_id: user.userId,
    filename,
    content_type: contentType ?? "application/pdf",
    byte_size: bytes.byteLength,
    content_hash: contentHash,
    storage_backend: storageBackend,
    storage_key: r2Stored ? storageKey : null,
    source: "user_upload",
    r2_binding_present: Boolean(c.env.UPLOADS_BUCKET),
    note: r2Stored ? null : "TODO: configure UPLOADS_BUCKET R2 binding for transient PDF bytes"
  };

  const ingestLogId = makeId("ingest");
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO paper_uploads (
          id, user_id, filename, content_type, byte_size, storage_backend,
          storage_key, status, expires_at, metrics_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
      ).bind(
        uploadId,
        user.userId,
        filename,
        contentType ?? "application/pdf",
        bytes.byteLength,
        storageBackend,
        r2Stored ? storageKey : null,
        expiresAt,
        JSON.stringify(metrics),
        now,
        now
      ),
      c.env.DB.prepare(
        `INSERT INTO ingest_log (
          id, source, status, batch_ref, error_code, metrics_json, started_at, finished_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)`
      ).bind(
        ingestLogId,
        "user_upload",
        r2Stored ? "queued" : "queued_metadata_only",
        uploadId,
        JSON.stringify({ ...metrics, ingest_log_id: ingestLogId }),
        now
      ),
      c.env.DB.prepare(
        `INSERT INTO pending_bibs (
          id, user_id, source_ref, status, retry_count, next_retry_at, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)`
      ).bind(
        makeId("pending"),
        user.userId,
        uploadId,
        now,
        JSON.stringify({
          kind: "pdf_upload",
          upload_id: uploadId,
          storage_backend: storageBackend,
          storage_key: r2Stored ? storageKey : null,
          content_hash: contentHash
        }),
        now,
        now
      )
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload metadata write failed";
    return jsonError(c, 500, "UPLOAD_PERSIST_FAILED", message);
  }

  return c.json(
    {
      ok: true,
      upload_id: uploadId,
      status: "queued",
      byte_size: bytes.byteLength,
      storage_backend: storageBackend,
      expires_at: expiresAt,
      ingest_log_id: ingestLogId,
      queue: {
        backend: "d1_stub",
        consumer: "colab_poll",
        poll_path: "/api/internal/ingest-queue",
        note: "CF Queue binding optional; pending_bibs row created for retry"
      },
      poll: {
        path: `/api/papers/upload-status/${uploadId}`,
        href: `/api/papers/upload-status/${uploadId}`
      }
    },
    202
  );
});

app.get("/api/papers/upload-status/:id", async (c) => {
  const uploadId = toOptionalString(c.req.param("id"));
  if (!uploadId) {
    return jsonError(c, 400, "MISSING_ID", "upload id is required");
  }
  const user = getRequestUser(c);

  try {
    const row = await c.env.DB.prepare(
      `SELECT
        id,
        user_id AS userId,
        filename,
        byte_size AS byteSize,
        storage_backend AS storageBackend,
        storage_key AS storageKey,
        status,
        expires_at AS expiresAt,
        metrics_json AS metricsJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM paper_uploads
      WHERE id = ?
      LIMIT 1`
    )
      .bind(uploadId)
      .first<{
        id: string;
        userId: string;
        filename: string | null;
        byteSize: number;
        storageBackend: string;
        storageKey: string | null;
        status: string;
        expiresAt: number;
        metricsJson: string | null;
        createdAt: number;
        updatedAt: number;
      }>();

    if (!row) {
      return jsonError(c, 404, "UPLOAD_NOT_FOUND", "upload id not found");
    }
    if (user && row.userId !== user.userId) {
      return jsonError(c, 403, "FORBIDDEN", "upload belongs to another user");
    }

    return c.json({
      ok: true,
      upload_id: row.id,
      status: row.status,
      byte_size: row.byteSize,
      filename: row.filename,
      storage_backend: row.storageBackend,
      storage_key: row.storageKey,
      expires_at: row.expiresAt,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      metrics: row.metricsJson ? JSON.parse(row.metricsJson) : null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload status lookup failed";
    return jsonError(c, 500, "UPLOAD_STATUS_FAILED", message);
  }
});

app.post("/api/library/import", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  let content = "";
  let format: ImportFormat = "auto";
  let filename: string | null = null;

  const requestContentType = c.req.header("content-type") ?? "";
  if (requestContentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const fileEntry = formData.get("file");
    if (isFormDataFile(fileEntry)) {
      content = await fileEntry.text();
      filename = fileEntry.name || null;
    } else {
      const rawContent = formData.get("content");
      content = typeof rawContent === "string" ? rawContent : "";
    }
    const rawFormat = formData.get("format");
    format = detectImportFormat(filename, null);
    if (typeof rawFormat === "string" && rawFormat.trim().length > 0) {
      format = rawFormat.trim().toLowerCase() as ImportFormat;
    }
  } else {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(c, 400, "INVALID_PAYLOAD", "request body must be valid JSON or multipart form");
    }
    if (!isRecord(body)) {
      return jsonError(c, 400, "INVALID_PAYLOAD", "payload must be an object");
    }
    content = toOptionalString(body.content) ?? "";
    filename = toOptionalString(body.filename);
    const rawFormat = toOptionalString(body.format);
    format = rawFormat ? (rawFormat.toLowerCase() as ImportFormat) : detectImportFormat(filename, null);
  }

  if (content.trim().length === 0) {
    return jsonError(c, 400, "EMPTY_IMPORT", "import content is empty");
  }
  if (content.length > 2 * 1024 * 1024) {
    return jsonError(c, 413, "IMPORT_TOO_LARGE", "import content exceeds 2 MB text limit");
  }

  const dois = extractDoisFromImport(content, format);
  if (dois.length === 0) {
    return jsonError(c, 400, "NO_DOIS_FOUND", "no DOIs detected in import content");
  }

  const now = nowUnixSeconds();
  const imported: { doi: string; node_id: string }[] = [];
  const queued: { doi: string; pending_id: string }[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const doi of dois) {
    const doiNorm = normalizeDoiForStorage(doi);
    if (!doiNorm) {
      continue;
    }
    const nodeId = await resolveNodeIdByDoi(c, doiNorm);
    if (nodeId) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO user_library (user_id, node_id, status, added_at, last_opened_at)
          VALUES (?, ?, 'saved', ?, NULL)
          ON CONFLICT(user_id, node_id) DO UPDATE SET status = 'saved'`
        ).bind(user.userId, nodeId, now)
      );
      imported.push({ doi: doiNorm, node_id: nodeId });
      continue;
    }

    const pendingId = makeId("pending");
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO pending_bibs (
          id, user_id, source_ref, status, retry_count, next_retry_at, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)`
      ).bind(
        pendingId,
        user.userId,
        doiNorm,
        now,
        JSON.stringify({
          kind: "library_import",
          doi: doiNorm,
          format,
          requested_at: now
        }),
        now,
        now
      )
    );
    queued.push({ doi: doiNorm, pending_id: pendingId });
  }

  if (statements.length > 0) {
    try {
      await c.env.DB.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Library import failed";
      return jsonError(c, 500, "LIBRARY_IMPORT_FAILED", message);
    }
  }

  return c.json({
    ok: true,
    format,
    filename,
    detected_dois: dois.length,
    imported_count: imported.length,
    queued_count: queued.length,
    imported,
    queued
  });
});

app.post("/api/library/add", async (c) => {
  const user = getRequestUser(c);
  if (!user) {
    return jsonError(c, 400, "MISSING_USER", "x-user-id header or user_id query parameter is required");
  }

  let doiRaw = toOptionalString(c.req.query("doi"));
  if (!doiRaw) {
    try {
      const body: unknown = await c.req.json();
      if (isRecord(body)) {
        doiRaw = toOptionalString(body.doi);
      }
    } catch {
      doiRaw = null;
    }
  }

  const doiNorm = doiRaw ? normalizeDoiForStorage(doiRaw) : null;
  if (!doiNorm) {
    return jsonError(c, 400, "INVALID_DOI", "doi query parameter or JSON body field is required");
  }

  const now = nowUnixSeconds();
  const nodeId = await resolveNodeIdByDoi(c, doiNorm);
  if (nodeId) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO user_library (user_id, node_id, status, added_at, last_opened_at)
        VALUES (?, ?, 'saved', ?, NULL)
        ON CONFLICT(user_id, node_id) DO UPDATE SET status = 'saved'`
      )
        .bind(user.userId, nodeId, now)
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Library add failed";
      return jsonError(c, 500, "LIBRARY_ADD_FAILED", message);
    }

    return c.json({
      ok: true,
      doi: doiNorm,
      node_id: nodeId,
      status: "saved"
    });
  }

  const pendingId = makeId("pending");
  try {
    await c.env.DB.prepare(
      `INSERT INTO pending_bibs (
        id, user_id, source_ref, status, retry_count, next_retry_at, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)`
    )
      .bind(
        pendingId,
        user.userId,
        doiNorm,
        now,
        JSON.stringify({
          kind: "library_add",
          doi: doiNorm,
          requested_at: now
        }),
        now,
        now
      )
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Library queue failed";
    return jsonError(c, 500, "LIBRARY_ADD_FAILED", message);
  }

  return c.json({
    ok: true,
    doi: doiNorm,
    status: "queued",
    pending_id: pendingId
  });
});

app.get("/api/resolve", async (c) => {
  const rawId = toOptionalString(c.req.query("id"));
  if (!rawId) {
    return jsonError(c, 400, "MISSING_ID", "id query parameter is required");
  }

  const parsed = parseResolveInput(rawId);
  if (!parsed.doi && !parsed.arxivId) {
    return jsonError(c, 400, "INVALID_ID", "id must be a DOI/arXiv identifier or supported URL");
  }

  try {
    let resolved: ResolvedPaperLookup | null = null;

    if (parsed.doi) {
      resolved = await lookupResolvedPaperByDoi(c, parsed.doi);
      if (!resolved) {
        resolved = await c.env.DB.prepare(
          `SELECT
            cn.id AS nodeId,
            cn.doi_norm AS doiNorm,
            COALESCE(ps.title, cn.title) AS title,
            ps.tldr AS tldr,
            cn.source_ref AS sourceRef
          FROM doi_aliases da
          JOIN cite_nodes cn ON cn.id = da.node_id
          LEFT JOIN paper_search ps ON ps.node_id = cn.id
          WHERE LOWER(da.doi_norm) = LOWER(?) OR LOWER(da.doi_raw) = LOWER(?)
          ORDER BY cn.updated_at DESC
          LIMIT 1`
        )
          .bind(parsed.doi, parsed.doi)
          .first<ResolvedPaperLookup>();
      }
    }

    if (!resolved && parsed.arxivId) {
      const arxivAbs = `https://arxiv.org/abs/${parsed.arxivId}`;
      const arxivPdf = `https://arxiv.org/pdf/${parsed.arxivId}.pdf`;
      const arxivTag = `arxiv:${parsed.arxivId}`;
      resolved = await c.env.DB.prepare(
        `SELECT
          cn.id AS nodeId,
          cn.doi_norm AS doiNorm,
          COALESCE(ps.title, cn.title) AS title,
          ps.tldr AS tldr,
          cn.source_ref AS sourceRef
        FROM cite_nodes cn
        LEFT JOIN paper_search ps ON ps.node_id = cn.id
        WHERE LOWER(cn.source_ref) = LOWER(?)
          OR LOWER(cn.source_ref) = LOWER(?)
          OR LOWER(cn.source_ref) = LOWER(?)
        ORDER BY cn.updated_at DESC
        LIMIT 1`
      )
        .bind(arxivAbs, arxivPdf, arxivTag)
        .first<ResolvedPaperLookup>();
    }

    const canonicalDoi = resolved?.doiNorm ? normalizeDoiForStorage(resolved.doiNorm) : null;
    if (resolved && canonicalDoi) {
      return c.json({
        ok: true,
        status: "resolved",
        input: rawId,
        canonical_doi: canonicalDoi,
        node_id: resolved.nodeId,
        title: resolved.title,
        tldr: resolved.tldr,
        redirect: {
          path: `/paper/${encodeURIComponent(canonicalDoi)}`,
          href: `/paper/${encodeURIComponent(canonicalDoi)}`
        }
      });
    }

    const now = nowUnixSeconds();
    const pendingId = makeId("pending");
    const user = getRequestUser(c);
    try {
      await c.env.DB.prepare(
        `INSERT INTO pending_bibs (
          id, user_id, source_ref, status, retry_count, next_retry_at, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)`
      )
        .bind(
          pendingId,
          user?.userId ?? "public",
          rawId,
          now,
          JSON.stringify({
            kind: parsed.kind,
            doi: parsed.doi,
            arxiv_id: parsed.arxivId,
            requested_at: now
          }),
          now,
          now
        )
        .run();
    } catch {
      // Queue write is best-effort; endpoint still returns pending status.
    }

    return c.json(
      {
        ok: true,
        status: "pending_ingest",
        input: rawId,
        pending_id: pendingId,
        message: "Identifier not found in paper_search, queued for ingest lookup"
      },
      202
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resolve lookup failed";
    return jsonError(c, 500, "RESOLVE_FAILED", message);
  }
});

app.get("/api/papers/badges", async (c) => {
  const dois = parseDoiList(c.req.query("dois"));
  if (dois.length === 0) {
    return jsonError(c, 400, "INVALID_DOIS", "dois query parameter must contain at least one DOI");
  }

  try {
    const nodeRows = await c.env.DB.prepare(
      `SELECT
        cn.id AS nodeId,
        cn.doi_norm AS doiNorm,
        COALESCE(ps.rank_signal, 0) AS rankSignal,
        COALESCE(ps.title, cn.title) AS title
      FROM cite_nodes cn
      LEFT JOIN paper_search ps ON ps.node_id = cn.id
      WHERE cn.doi_norm IN (${dois.map(() => "?").join(", ")})`
    )
      .bind(...dois)
      .all<{ nodeId: string; doiNorm: string; rankSignal: number | null; title: string | null }>();

    const nodes = nodeRows.results ?? [];
    const nodeIds = nodes.map((row) => row.nodeId);
    if (nodeIds.length === 0) {
      return c.json({ ok: true, items: [] });
    }

    const idPlaceholders = nodeIds.map(() => "?").join(", ");
    const [intentRows, influentialRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT
          e.to_node_id AS nodeId,
          e.edge_type AS edgeType,
          COUNT(*) AS edgeCount
        FROM cite_edges e
        WHERE e.to_node_id IN (${idPlaceholders})
          AND e.status = 'active'
        GROUP BY e.to_node_id, e.edge_type`
      )
        .bind(...nodeIds)
        .all<{ nodeId: string; edgeType: string; edgeCount: number }>(),
      c.env.DB.prepare(
        `SELECT
          e.to_node_id AS nodeId,
          COUNT(*) AS influentialCount
        FROM cite_edges e
        WHERE e.to_node_id IN (${idPlaceholders})
          AND e.status = 'active'
          AND (
            COALESCE(e.weight, 0) >= 0.95
            OR LOWER(e.edge_type) IN ('supports', 'extends')
          )
        GROUP BY e.to_node_id`
      )
        .bind(...nodeIds)
        .all<{ nodeId: string; influentialCount: number }>()
    ]);

    const intentByNode = new Map<string, Record<string, number>>();
    for (const row of intentRows.results ?? []) {
      const bucket =
        intentByNode.get(row.nodeId) ??
        {
          supports: 0,
          contradicts: 0,
          extends: 0,
          method: 0,
          data: 0,
          mentions: 0
        };
      const key = row.edgeType.toLowerCase();
      if (key in bucket) {
        bucket[key] = row.edgeCount;
      } else {
        bucket.mentions += row.edgeCount;
      }
      intentByNode.set(row.nodeId, bucket);
    }

    const influentialByNode = new Map<string, number>();
    for (const row of influentialRows.results ?? []) {
      influentialByNode.set(row.nodeId, row.influentialCount);
    }

    const items = nodes.map((node) => {
      const intents = intentByNode.get(node.nodeId) ?? {
        supports: 0,
        contradicts: 0,
        extends: 0,
        method: 0,
        data: 0,
        mentions: 0
      };
      return {
        doi: node.doiNorm,
        title: node.title,
        citation_count: Math.max(0, Math.trunc(node.rankSignal ?? 0)),
        influential_count: influentialByNode.get(node.nodeId) ?? 0,
        ...intents
      };
    });

    return c.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paper badges query failed";
    return jsonError(c, 500, "PAPER_BADGES_FAILED", message);
  }
});

type PaperBadgePayload = {
  doi: string;
  title: string | null;
  citation_count: number;
  influential_count: number;
  supports: number;
  contradicts: number;
  extends: number;
  method: number;
  data: number;
  mentions: number;
};

async function buildPaperBadgeForDoi(
  c: Context<{ Bindings: Env }>,
  doiNorm: string
): Promise<PaperBadgePayload | null> {
  const nodeId = await resolveNodeIdByDoi(c, doiNorm);
  if (!nodeId) {
    return null;
  }

  const paper = await c.env.DB.prepare(
    `SELECT
      COALESCE(ps.rank_signal, 0) AS rankSignal,
      COALESCE(ps.title, cn.title) AS title
    FROM cite_nodes cn
    LEFT JOIN paper_search ps ON ps.node_id = cn.id
    WHERE cn.id = ?
    LIMIT 1`
  )
    .bind(nodeId)
    .first<{ rankSignal: number | null; title: string | null }>();

  const intentRows = await c.env.DB.prepare(
    `SELECT
      e.edge_type AS edgeType,
      COUNT(*) AS edgeCount
    FROM cite_edges e
    WHERE e.to_node_id = ?
      AND e.status = 'active'
    GROUP BY e.edge_type
    LIMIT 20`
  )
    .bind(nodeId)
    .all<{ edgeType: string; edgeCount: number }>();

  const influentialRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS influentialCount
    FROM cite_edges e
    WHERE e.to_node_id = ?
      AND e.status = 'active'
      AND (
        COALESCE(e.weight, 0) >= 0.95
        OR LOWER(e.edge_type) IN ('supports', 'extends')
      )`
  )
    .bind(nodeId)
    .first<{ influentialCount: number }>();

  const intentCounts: Record<string, number> = {
    supports: 0,
    contradicts: 0,
    extends: 0,
    method: 0,
    data: 0,
    mentions: 0
  };
  for (const row of intentRows.results ?? []) {
    const key = row.edgeType.toLowerCase();
    if (key in intentCounts) {
      intentCounts[key] = row.edgeCount;
    } else {
      intentCounts.mentions += row.edgeCount;
    }
  }

  return {
    doi: doiNorm,
    title: paper?.title ?? null,
    citation_count: Math.max(0, Math.trunc(paper?.rankSignal ?? 0)),
    influential_count: influentialRow?.influentialCount ?? 0,
    supports: intentCounts.supports,
    contradicts: intentCounts.contradicts,
    extends: intentCounts.extends,
    method: intentCounts.method,
    data: intentCounts.data,
    mentions: intentCounts.mentions
  };
}

app.post("/api/papers/badges", async (c) => {
  let body: { dois?: unknown };
  try {
    body = await c.req.json<{ dois?: unknown }>();
  } catch {
    return jsonError(c, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const rawDois = Array.isArray(body.dois) ? body.dois : [];
  const uniqueDois = [
    ...new Set(
      rawDois
        .map((value) => normalizeDoiForStorage(String(value ?? "")))
        .filter((value): value is string => Boolean(value))
    )
  ].slice(0, 20);

  if (uniqueDois.length === 0) {
    return jsonError(c, 400, "MISSING_DOIS", "dois must be a non-empty array");
  }

  try {
    const badges: PaperBadgePayload[] = [];
    for (const doiNorm of uniqueDois) {
      const badge = await buildPaperBadgeForDoi(c, doiNorm);
      if (badge) {
        badges.push(badge);
      }
    }
    return c.json({ ok: true, badges });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paper badges query failed";
    logStructured(c, "error", "papers.badges.failed", { message, count: uniqueDois.length });
    return jsonError(c, 500, "PAPER_BADGES_FAILED", message);
  }
});

app.get("/api/papers/:doi/badge", async (c) => {
  const doiNorm = normalizeDoiForStorage(decodeURIComponent(c.req.param("doi")));
  if (!doiNorm) {
    return jsonError(c, 400, "INVALID_DOI", "doi path parameter must be valid");
  }

  try {
    const badge = await buildPaperBadgeForDoi(c, doiNorm);
    if (!badge) {
      return jsonError(c, 404, "DOI_NOT_FOUND", "No paper node found for this DOI");
    }
    return c.json({ ok: true, ...badge });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paper badge query failed";
    logStructured(c, "error", "papers.badge.failed", { message, doi: doiNorm });
    return jsonError(c, 500, "PAPER_BADGE_FAILED", message);
  }
});

app.get("/api/public/paper/:doi", async (c) => {
  const doiNorm = normalizeDoiForStorage(decodeURIComponent(c.req.param("doi")));
  if (!doiNorm) {
    return jsonError(c, 400, "INVALID_DOI", "doi path parameter must be valid");
  }

  try {
    let paper = await c.env.DB.prepare(
      `SELECT
        cn.id AS nodeId,
        cn.doi_norm AS doiNorm,
        COALESCE(ps.title, cn.title) AS title,
        ps.authors_text AS authorsText,
        COALESCE(ps.publication_year, cn.publication_year) AS publicationYear,
        COALESCE(ps.venue, cn.venue) AS venue,
        ps.rank_signal AS rankSignal,
        ps.tldr AS tldr,
        cn.source_ref AS sourceRef
      FROM cite_nodes cn
      LEFT JOIN paper_search ps ON ps.node_id = cn.id
      WHERE LOWER(cn.doi_norm) = LOWER(?)
      LIMIT 1`
    )
      .bind(doiNorm)
      .first<{
        nodeId: string;
        doiNorm: string | null;
        title: string;
        authorsText: string | null;
        publicationYear: number | null;
        venue: string | null;
        rankSignal: number | null;
        tldr: string | null;
        sourceRef: string | null;
      }>();

    if (!paper) {
      paper = await c.env.DB.prepare(
        `SELECT
          cn.id AS nodeId,
          cn.doi_norm AS doiNorm,
          COALESCE(ps.title, cn.title) AS title,
          ps.authors_text AS authorsText,
          COALESCE(ps.publication_year, cn.publication_year) AS publicationYear,
          COALESCE(ps.venue, cn.venue) AS venue,
          ps.rank_signal AS rankSignal,
          ps.tldr AS tldr,
          cn.source_ref AS sourceRef
        FROM doi_aliases da
        JOIN cite_nodes cn ON cn.id = da.node_id
        LEFT JOIN paper_search ps ON ps.node_id = cn.id
        WHERE LOWER(da.doi_norm) = LOWER(?) OR LOWER(da.doi_raw) = LOWER(?)
        LIMIT 1`
      )
        .bind(doiNorm, doiNorm)
        .first<{
          nodeId: string;
          doiNorm: string | null;
          title: string;
          authorsText: string | null;
          publicationYear: number | null;
          venue: string | null;
          rankSignal: number | null;
          tldr: string | null;
          sourceRef: string | null;
        }>();
    }

    if (!paper) {
      return jsonError(c, 404, "PAPER_NOT_FOUND", "paper not found");
    }

    const authorsResult = await c.env.DB.prepare(
      `SELECT author_name
      FROM paper_authors
      WHERE node_id = ?
      ORDER BY author_order ASC
      LIMIT ?`
    )
      .bind(paper.nodeId, PAPER_DETAIL_MAX_AUTHORS)
      .all<{ author_name: string }>();
    const topicsResult = await c.env.DB.prepare(
      `SELECT topic, score
      FROM paper_topics
      WHERE node_id = ?
      ORDER BY COALESCE(score, 0) DESC
      LIMIT ?`
    )
      .bind(paper.nodeId, PAPER_DETAIL_MAX_TOPICS)
      .all<{ topic: string; score: number | null }>();

    return c.json({
      ok: true,
      item: {
        node_id: paper.nodeId,
        doi: paper.doiNorm,
        title: paper.title,
        authors_text: paper.authorsText,
        authors: (authorsResult.results ?? []).map((row) => row.author_name),
        publication_year: paper.publicationYear,
        venue: paper.venue,
        rank_signal: paper.rankSignal ?? 0,
        tldr: paper.tldr,
        source_ref: paper.sourceRef,
        topics: topicsResult.results ?? []
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Public paper query failed";
    return jsonError(c, 500, "PUBLIC_PAPER_FAILED", message);
  }
});

app.get("/api/public/cite/:id", async (c) => {
  const edgeId = toOptionalString(c.req.param("id"));
  if (!edgeId) {
    return jsonError(c, 400, "INVALID_ID", "cite id is required");
  }

  try {
    const edge = await c.env.DB.prepare(
      `SELECT
        e.id AS edgeId,
        e.edge_type AS edgeType,
        e.weight AS weight,
        e.evidence_ref AS evidenceRef,
        e.created_at AS createdAt,
        src.id AS sourceNodeId,
        src.doi_norm AS sourceDoi,
        COALESCE(srcPs.title, src.title) AS sourceTitle,
        srcPs.publication_year AS sourceYear,
        srcPs.authors_text AS sourceAuthors,
        tgt.id AS targetNodeId,
        tgt.doi_norm AS targetDoi,
        COALESCE(tgtPs.title, tgt.title) AS targetTitle,
        tgtPs.publication_year AS targetYear,
        tgtPs.authors_text AS targetAuthors
      FROM cite_edges e
      JOIN cite_nodes src ON src.id = e.from_node_id
      JOIN cite_nodes tgt ON tgt.id = e.to_node_id
      LEFT JOIN paper_search srcPs ON srcPs.node_id = src.id
      LEFT JOIN paper_search tgtPs ON tgtPs.node_id = tgt.id
      WHERE e.id = ?
      LIMIT 1`
    )
      .bind(edgeId)
      .first<{
        edgeId: string;
        edgeType: string;
        weight: number | null;
        evidenceRef: string | null;
        createdAt: number;
        sourceNodeId: string;
        sourceDoi: string | null;
        sourceTitle: string;
        sourceYear: number | null;
        sourceAuthors: string | null;
        targetNodeId: string;
        targetDoi: string | null;
        targetTitle: string;
        targetYear: number | null;
        targetAuthors: string | null;
      }>();
    if (!edge) {
      return jsonError(c, 404, "CITE_NOT_FOUND", "cite edge not found");
    }

    return c.json({
      ok: true,
      item: {
        id: edge.edgeId,
        edge_type: edge.edgeType,
        weight: edge.weight,
        evidence_ref: edge.evidenceRef,
        created_at: edge.createdAt,
        source: {
          node_id: edge.sourceNodeId,
          doi: edge.sourceDoi,
          title: edge.sourceTitle,
          publication_year: edge.sourceYear,
          authors_text: edge.sourceAuthors
        },
        target: {
          node_id: edge.targetNodeId,
          doi: edge.targetDoi,
          title: edge.targetTitle,
          publication_year: edge.targetYear,
          authors_text: edge.targetAuthors
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Public cite query failed";
    return jsonError(c, 500, "PUBLIC_CITE_FAILED", message);
  }
});

app.get("/api/public/timeline/:id", async (c) => {
  const sourceNodeId = toOptionalString(c.req.param("id"));
  if (!sourceNodeId) {
    return jsonError(c, 400, "MISSING_ID", "timeline id is required");
  }
  const limit = parsePositiveInt(c.req.query("limit"), 25, 100);

  try {
    const sourceNode = await c.env.DB.prepare(
      `SELECT
        cn.id AS nodeId,
        cn.title AS title,
        cn.doi_norm AS doiNorm,
        ps.publication_year AS publicationYear
      FROM cite_nodes cn
      LEFT JOIN paper_search ps ON ps.node_id = cn.id
      WHERE cn.id = ?
      LIMIT 1`
    )
      .bind(sourceNodeId)
      .first<{ nodeId: string; title: string; doiNorm: string | null; publicationYear: number | null }>();
    if (!sourceNode) {
      return jsonError(c, 404, "NODE_NOT_FOUND", "timeline source node not found");
    }

    const result = await c.env.DB.prepare(
      `SELECT
        e.id AS edgeId,
        e.edge_type AS edgeType,
        CASE WHEN e.from_node_id = ? THEN 'outbound' ELSE 'inbound' END AS direction,
        related.id AS relatedNodeId,
        COALESCE(ps.title, related.title) AS title,
        COALESCE(ps.publication_year, related.publication_year) AS publicationYear,
        COALESCE(ps.venue, related.venue) AS venue,
        related.doi_norm AS doiNorm,
        ps.authors_text AS authorsText,
        ps.topic_terms AS topicTerms
      FROM cite_edges e
      JOIN cite_nodes related ON related.id = CASE
        WHEN e.from_node_id = ? THEN e.to_node_id
        ELSE e.from_node_id
      END
      LEFT JOIN paper_search ps ON ps.node_id = related.id
      WHERE e.from_node_id = ? OR e.to_node_id = ?
      ORDER BY COALESCE(ps.publication_year, related.publication_year, 0) ASC, e.created_at ASC
      LIMIT ?`
    )
      .bind(sourceNodeId, sourceNodeId, sourceNodeId, sourceNodeId, limit)
      .all<TimelineCard>();

    return c.json({
      ok: true,
      source: sourceNode,
      items: result.results ?? []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Public timeline query failed";
    return jsonError(c, 500, "PUBLIC_TIMELINE_FAILED", message);
  }
});

app.get("/api/public/search", async (c) => {
  const query = (c.req.query("q") ?? "").trim();
  if (query.length < 2) {
    return jsonError(c, 400, "INVALID_QUERY", "q query parameter must be at least 2 characters");
  }
  const limit = parsePositiveInt(c.req.query("limit"), 20, 50);
  const like = `%${query}%`;

  try {
    const result = await c.env.DB.prepare(
      `SELECT
        ps.node_id AS nodeId,
        ps.title AS title,
        ps.doi_norm AS doiNorm,
        ps.authors_text AS authorsText,
        ps.publication_year AS publicationYear,
        ps.venue AS venue,
        ps.rank_signal AS rankSignal,
        ps.tldr AS tldr
      FROM paper_search ps
      WHERE LOWER(ps.title) LIKE LOWER(?)
        OR LOWER(COALESCE(ps.authors_text, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(ps.venue, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(ps.topic_terms, '')) LIKE LOWER(?)
      ORDER BY COALESCE(ps.rank_signal, 0) DESC, COALESCE(ps.publication_year, 0) DESC
      LIMIT ?`
    )
      .bind(like, like, like, like, limit)
      .all<{
        nodeId: string;
        title: string;
        doiNorm: string | null;
        authorsText: string | null;
        publicationYear: number | null;
        venue: string | null;
        rankSignal: number | null;
        tldr: string | null;
      }>();

    return c.json({
      ok: true,
      query,
      items: (result.results ?? []).map((item) => ({
        node_id: item.nodeId,
        doi: item.doiNorm,
        title: item.title,
        authors_text: item.authorsText,
        publication_year: item.publicationYear,
        venue: item.venue,
        rank_signal: item.rankSignal ?? 0,
        tldr: item.tldr
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Public search failed";
    return jsonError(c, 500, "PUBLIC_SEARCH_FAILED", message);
  }
});

app.get("/api/pdf/proxy", async (c) => {
  const rawUrl = c.req.query("url")?.trim();
  const rawDoi = c.req.query("doi")?.trim();
  if (!rawUrl && !rawDoi) {
    return jsonError(c, 400, "MISSING_TARGET", "url or doi query parameter is required");
  }

  const parsedUrl = normalizePdfTarget(rawUrl, rawDoi);
  if (!parsedUrl) {
    return jsonError(
      c,
      400,
      "INVALID_TARGET",
      "invalid url/doi format or unsupported protocol"
    );
  }

  if (!isAllowedPdfUrl(parsedUrl)) {
    return jsonError(c, 403, "URL_NOT_ALLOWED", "url is not in the PDF allowlist");
  }

  const rateLimitKey = parsedUrl.toString().toLowerCase();
  const circuitGate = allowPdfCircuitRequest(rateLimitKey);
  if (!circuitGate.allowed) {
    logStructured(c, "warn", "pdf.proxy.circuit_open", {
      target: rateLimitKey,
      state: circuitGate.state,
      retry_after: circuitGate.retryAfterSec
    });
    return c.json(
      {
        error: {
          code: "PUBLISHER_CIRCUIT_OPEN",
          message: "publisher circuit breaker is open for this DOI/URL"
        },
        circuit_state: circuitGate.state,
        retry_after: circuitGate.retryAfterSec
      },
      503,
      {
        "retry-after": String(circuitGate.retryAfterSec),
        "x-circuit-state": circuitGate.state
      }
    );
  }

  const rateLimitResult = checkPdfProxyRateLimit(rateLimitKey);
  if (!rateLimitResult.allowed) {
    return c.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "too many PDF proxy requests for this DOI/URL"
        },
        retry_after: rateLimitResult.retryAfterSec
      },
      429,
      {
        "retry-after": String(rateLimitResult.retryAfterSec)
      }
    );
  }

  const requestHeaders = new Headers({
    accept: "application/pdf,*/*;q=0.8",
    "user-agent": pickRotatingUserAgent(rateLimitKey)
  });
  const incomingRange = c.req.header("range");
  if (incomingRange) {
    requestHeaders.set("range", incomingRange);
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsedUrl.toString(), {
      headers: requestHeaders,
      cf: {
        cacheTtl: PDF_PROXY_CACHE_TTL_SECONDS,
        cacheEverything: true
      }
    });
  } catch {
    recordPdfCircuitFailure(rateLimitKey);
    return jsonError(c, 502, "UPSTREAM_UNREACHABLE", "failed to fetch upstream PDF");
  }

  if (upstream.status === 429 || upstream.status === 403) {
    recordPdfCircuitFailure(rateLimitKey);
    const upstreamRetryAfter = Number.parseInt(upstream.headers.get("retry-after") ?? "", 10);
    const retryAfter = Number.isFinite(upstreamRetryAfter) && upstreamRetryAfter > 0
      ? upstreamRetryAfter
      : PDF_PROXY_DEFAULT_BACKOFF_SECONDS;
    return c.json(
      {
        error: {
          code: "PUBLISHER_THROTTLED",
          message: `upstream throttled request with status ${upstream.status}`
        },
        circuit_state: getPdfCircuitBreakerSnapshot(rateLimitKey).state,
        retry_after: retryAfter
      },
      429,
      {
        "retry-after": String(retryAfter),
        "x-circuit-state": getPdfCircuitBreakerSnapshot(rateLimitKey).state
      }
    );
  }

  if (!upstream.ok) {
    if (upstream.status >= 500) {
      recordPdfCircuitFailure(rateLimitKey);
    }
    return jsonError(
      c,
      502,
      "UPSTREAM_ERROR",
      `upstream returned status ${upstream.status}`
    );
  }

  recordPdfCircuitSuccess(rateLimitKey);

  const responseHeaders = new Headers();
  for (const key of [
    "accept-ranges",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified"
  ]) {
    const value = upstream.headers.get(key);
    if (value) {
      responseHeaders.set(key, value);
    }
  }
  responseHeaders.set(
    "cache-control",
    `public, max-age=0, s-maxage=${PDF_PROXY_CACHE_TTL_SECONDS}, stale-while-revalidate=600, stale-if-error=86400`
  );
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set("x-proxy-target", parsedUrl.hostname.toLowerCase());
  responseHeaders.set("x-circuit-state", getPdfCircuitBreakerSnapshot(rateLimitKey).state);
  responseHeaders.set("vary", "range");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
});

const worker = {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const handle = async () => {
      try {
        const summary = await runDeterministicRevalidationCron(env);
        console.log(
          JSON.stringify({
            level: "info",
            event: "cron.revalidation.completed",
            cron: event.cron,
            scanned: summary.scanned,
            updated: summary.updated,
            pages: summary.pages,
            ts: new Date().toISOString()
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown cron failure";
        console.log(
          JSON.stringify({
            level: "error",
            event: "cron.revalidation.failed",
            cron: event.cron,
            message,
            ts: new Date().toISOString()
          })
        );
      }
    };
    ctx.waitUntil(handle());
  }
};

export default worker;
