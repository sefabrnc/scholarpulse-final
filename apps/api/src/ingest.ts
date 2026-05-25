const DOI_CAPTURE = /\b(10\.\d{4,9}\/[^\s,}\]"']+)/gi;
const BIB_DOI_FIELD = /\bdoi\s*=\s*[{"']?([^,"'\n}]+)[}"',]?/gi;
const RIS_DO_FIELD = /^DO\s*-\s*(.+)$/gim;

export const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024;
export const PDF_UPLOAD_TTL_SECONDS = 24 * 60 * 60;

export type ImportFormat = "bibtex" | "ris" | "zotero" | "auto";

export function sanitizeDoiToken(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  const withoutSuffix = trimmed.replace(/[.,;)]+$/, "");
  if (!/^10\.\d{4,9}\/\S+$/.test(withoutSuffix)) {
    return null;
  }
  return withoutSuffix;
}

export function extractDoisFromText(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(DOI_CAPTURE)) {
    const doi = sanitizeDoiToken(match[1] ?? "");
    if (doi) {
      found.add(doi);
    }
  }
  return Array.from(found);
}

export function extractDoisFromBibTeX(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(BIB_DOI_FIELD)) {
    const doi = sanitizeDoiToken(match[1] ?? "");
    if (doi) {
      found.add(doi);
    }
  }
  for (const doi of extractDoisFromText(content)) {
    found.add(doi);
  }
  return Array.from(found);
}

export function extractDoisFromRis(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(RIS_DO_FIELD)) {
    const doi = sanitizeDoiToken(match[1] ?? "");
    if (doi) {
      found.add(doi);
    }
  }
  for (const doi of extractDoisFromText(content)) {
    found.add(doi);
  }
  return Array.from(found);
}

export function extractDoisFromZoteroJson(content: string): string[] {
  const found = new Set<string>();
  try {
    const parsed = JSON.parse(content) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.items)
        ? parsed.items
        : [];
    for (const item of items) {
      if (!isRecord(item)) {
        continue;
      }
      const rawDoi =
        (typeof item.DOI === "string" && item.DOI) ||
        (typeof item.doi === "string" && item.doi) ||
        "";
      const doi = sanitizeDoiToken(rawDoi);
      if (doi) {
        found.add(doi);
      }
    }
  } catch {
    return extractDoisFromText(content);
  }
  for (const doi of extractDoisFromText(content)) {
    found.add(doi);
  }
  return Array.from(found);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractDoisFromImport(content: string, format: ImportFormat): string[] {
  const normalized = format.trim().toLowerCase();
  if (normalized === "zotero") {
    return extractDoisFromZoteroJson(content);
  }
  if (normalized === "ris") {
    return extractDoisFromRis(content);
  }
  if (normalized === "bibtex") {
    return extractDoisFromBibTeX(content);
  }
  const zoteroDois = extractDoisFromZoteroJson(content);
  if (zoteroDois.length > 0 && content.trim().startsWith("{")) {
    return zoteroDois;
  }
  const risDois = extractDoisFromRis(content);
  if (risDois.length > 0) {
    return risDois;
  }
  return extractDoisFromBibTeX(content);
}

export function detectImportFormat(filename: string | null, contentType: string | null): ImportFormat {
  const name = (filename ?? "").toLowerCase();
  const type = (contentType ?? "").toLowerCase();
  if (name.endsWith(".ris") || type.includes("x-research-info-systems")) {
    return "ris";
  }
  if (name.endsWith(".json") || type.includes("json")) {
    return "zotero";
  }
  if (name.endsWith(".bib") || name.endsWith(".bibtex") || type.includes("bibtex")) {
    return "bibtex";
  }
  return "auto";
}

export function decodeBase64Payload(raw: string): Uint8Array {
  const normalized = raw.includes(",") ? raw.split(",").pop() ?? raw : raw;
  const binary = atob(normalized.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function sha256HexFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
