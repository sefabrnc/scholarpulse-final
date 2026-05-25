const SP_DOI_REGEX = /\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/gi;

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
function spNormalizeDoi(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  let value = raw.trim();
  if (!value) {
    return null;
  }

  value = value.replace(/^https?:\/\//i, "");
  value = value.replace(/^(dx\.)?doi\.org\//i, "");
  value = value.replace(/^doi:/i, "");
  value = value.replace(/[?.#].*$/, "");
  value = value.replace(/\/+$/, "");
  value = value.toLowerCase();

  if (!/^10\.\d{4,9}\/.+/.test(value)) {
    return null;
  }

  return value;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function spExtractDois(text) {
  const found = new Set();
  if (!text) {
    return [];
  }

  for (const match of text.matchAll(SP_DOI_REGEX)) {
    const normalized = spNormalizeDoi(match[1]);
    if (normalized) {
      found.add(normalized);
    }
  }

  return Array.from(found);
}

/**
 * @param {string} href
 * @returns {string | null}
 */
function spDoiFromHref(href) {
  if (!href) {
    return null;
  }

  try {
    const url = new URL(href, window.location.href);
    if (/doi\.org$/i.test(url.hostname) || /dx\.doi\.org$/i.test(url.hostname)) {
      return spNormalizeDoi(url.pathname.replace(/^\//, ""));
    }
  } catch {
    return spNormalizeDoi(href);
  }

  return spExtractDois(href)[0] || null;
}

/**
 * @returns {string | null}
 */
function spDoiFromDocumentMeta() {
  const selectors = [
    'meta[name="citation_doi"]',
    'meta[name="DC.Identifier"]',
    'meta[property="citation_doi"]'
  ];

  for (const selector of selectors) {
    const node = document.querySelector(selector);
    const content = node?.getAttribute("content");
    const normalized = spNormalizeDoi(content);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

/**
 * @returns {"doi" | "scholar" | "pubmed" | "unknown"}
 */
function spDetectPageKind() {
  const host = window.location.hostname.toLowerCase();
  if (host.includes("scholar.google.")) {
    return "scholar";
  }
  if (host.includes("pubmed.ncbi.nlm.nih.gov")) {
    return "pubmed";
  }
  if (host === "doi.org" || host === "dx.doi.org") {
    return "doi";
  }
  return "unknown";
}

/**
 * @returns {string | null}
 */
function spDoiFromCurrentPage() {
  const kind = spDetectPageKind();

  if (kind === "doi") {
    const fromPath = spNormalizeDoi(window.location.pathname.replace(/^\//, ""));
    if (fromPath) {
      return fromPath;
    }
  }

  const fromMeta = spDoiFromDocumentMeta();
  if (fromMeta) {
    return fromMeta;
  }

  const fromLinks = Array.from(document.querySelectorAll("a[href*='doi.org'], a[href*='10.']"))
    .map((anchor) => spDoiFromHref(anchor.getAttribute("href") || ""))
    .find(Boolean);

  return fromLinks || null;
}

if (typeof globalThis !== "undefined") {
  globalThis.spNormalizeDoi = spNormalizeDoi;
  globalThis.spExtractDois = spExtractDois;
  globalThis.spDoiFromHref = spDoiFromHref;
  globalThis.spDoiFromDocumentMeta = spDoiFromDocumentMeta;
  globalThis.spDetectPageKind = spDetectPageKind;
  globalThis.spDoiFromCurrentPage = spDoiFromCurrentPage;
}
