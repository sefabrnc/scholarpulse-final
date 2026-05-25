const SP_BADGE_CLASS = "sp-ext-badge";
const SP_BADGE_LOADING = "sp-ext-badge--loading";
const SP_BADGE_ERROR = "sp-ext-badge--error";
const SP_MOUNTED_ATTR = "data-sp-ext-mounted";

/** @type {number | null} */
let injectTimer = null;

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function formatBadgeSummary(payload) {
  const citations = Number(payload.citation_count || 0);
  const supports = Number(payload.supports || 0);
  const contradicts = Number(payload.contradicts || 0);
  const influential = Number(payload.influential_count || 0);

  const parts = [`${citations} cites`];
  if (influential > 0) {
    parts.push(`${influential} influential`);
  }
  if (supports > 0 || contradicts > 0) {
    parts.push(`${supports} sup`);
    parts.push(`${contradicts} con`);
  }

  return parts.join(" · ");
}

/**
 * @param {string | null | undefined} message
 * @returns {string}
 */
function humanizeBadgeError(message) {
  const text = String(message || "").trim();
  if (!text) {
    return "Badge unavailable";
  }
  if (/failed to fetch|networkerror|fetch_failed/i.test(text)) {
    return "API unreachable (check extension settings)";
  }
  if (/http_404|not found|404/i.test(text)) {
    return "Paper not in ScholarPulse yet";
  }
  if (/http_502|http_503|http_504/i.test(text)) {
    return "ScholarPulse API temporarily unavailable";
  }
  return text;
}

/**
 * @param {HTMLElement} host
 * @param {string} doi
 */
function mountBadge(host, doi) {
  if (host.getAttribute(SP_MOUNTED_ATTR) === doi) {
    return;
  }

  host.setAttribute(SP_MOUNTED_ATTR, doi);
  let badge = host.querySelector(`.${SP_BADGE_CLASS}`);
  if (!badge) {
    badge = document.createElement("span");
    badge.className = `${SP_BADGE_CLASS} ${SP_BADGE_LOADING}`;
    host.appendChild(badge);
  } else {
    badge.className = `${SP_BADGE_CLASS} ${SP_BADGE_LOADING}`;
  }

  badge.textContent = "ScholarPulse…";
  badge.title = `ScholarPulse badge for ${doi}`;

  chrome.runtime.sendMessage({ type: "SP_FETCH_BADGE", doi }, (response) => {
    if (chrome.runtime.lastError) {
      badge.classList.remove(SP_BADGE_LOADING);
      badge.classList.add(SP_BADGE_ERROR);
      badge.textContent = humanizeBadgeError(chrome.runtime.lastError.message);
      return;
    }

    if (!response?.ok) {
      badge.classList.remove(SP_BADGE_LOADING);
      badge.classList.add(SP_BADGE_ERROR);
      badge.textContent = humanizeBadgeError(response?.error);
      return;
    }

    badge.classList.remove(SP_BADGE_LOADING, SP_BADGE_ERROR);
    badge.textContent = formatBadgeSummary(response.payload);
  });
}

/**
 * @param {Element} row
 * @returns {string | null}
 */
function extractDoiFromScholarRow(row) {
  const doiLink = row.querySelector('a[href*="doi.org"], a[href*="dx.doi.org"]');
  if (doiLink) {
    const fromLink = spDoiFromHref(doiLink.getAttribute("href") || "");
    if (fromLink) {
      return fromLink;
    }
  }

  const text = row.textContent || "";
  return spExtractDois(text)[0] || null;
}

/**
 * @param {Element} row
 * @returns {HTMLElement | null}
 */
function scholarBadgeHost(row) {
  const titleBlock = row.querySelector(".gs_rt, .gsc_a_at, h3");
  if (titleBlock instanceof HTMLElement) {
    return titleBlock;
  }
  return row instanceof HTMLElement ? row : null;
}

function injectScholarBadges() {
  const rows = document.querySelectorAll(".gs_ri, .gs_r, .gsc_a_tr");
  rows.forEach((row) => {
    const doi = extractDoiFromScholarRow(row);
    if (!doi) {
      return;
    }
    const host = scholarBadgeHost(row);
    if (!host) {
      return;
    }
    mountBadge(host, doi);
  });
}

/**
 * @param {Element} article
 * @returns {string | null}
 */
function extractDoiFromPubMedArticle(article) {
  const doiLink = article.querySelector('a[href*="doi.org"], a[data-ga-action="DOI"]');
  if (doiLink) {
    const fromLink = spDoiFromHref(doiLink.getAttribute("href") || "");
    if (fromLink) {
      return fromLink;
    }
  }

  const citationMeta = article.querySelector('.citation-doi, [data-citation-doi]');
  if (citationMeta) {
    const fromMeta = spNormalizeDoi(
      citationMeta.getAttribute("data-citation-doi") || citationMeta.textContent || ""
    );
    if (fromMeta) {
      return fromMeta;
    }
  }

  const text = article.textContent || "";
  return spExtractDois(text)[0] || spDoiFromDocumentMeta();
}

/**
 * @param {Element} article
 * @returns {HTMLElement | null}
 */
function pubMedBadgeHost(article) {
  const titleBlock = article.querySelector(
    ".docsum-title, .heading-title, .title, .article-title, h1"
  );
  if (titleBlock instanceof HTMLElement) {
    return titleBlock;
  }
  return article instanceof HTMLElement ? article : null;
}

function injectPubMedBadges() {
  const articles = document.querySelectorAll(
    ".docsum-wrap, .search-results-chunk article, .article-details, .full-view"
  );
  articles.forEach((article) => {
    const doi = extractDoiFromPubMedArticle(article);
    if (!doi) {
      return;
    }
    const host = pubMedBadgeHost(article);
    if (!host) {
      return;
    }
    mountBadge(host, doi);
  });
}

function injectDoiPageBadge() {
  const doi = spDoiFromCurrentPage();
  if (!doi) {
    return;
  }

  if (document.querySelector(".sp-ext-doi-banner")) {
    const slot = document.querySelector(".sp-ext-doi-banner__slot");
    if (slot instanceof HTMLElement) {
      mountBadge(slot, doi);
    }
    return;
  }

  const host = document.querySelector("main") || document.body;
  const banner = document.createElement("div");
  banner.className = "sp-ext-doi-banner";
  banner.innerHTML = `<strong>ScholarPulse</strong><span class="sp-ext-doi-banner__slot"></span>`;
  host.prepend(banner);
  const slot = banner.querySelector(".sp-ext-doi-banner__slot");
  if (slot instanceof HTMLElement) {
    mountBadge(slot, doi);
  }
}

function runInjectors() {
  const kind = spDetectPageKind();
  if (kind === "scholar") {
    injectScholarBadges();
  } else if (kind === "pubmed") {
    injectPubMedBadges();
  } else if (kind === "doi") {
    injectDoiPageBadge();
  }
}

function scheduleInjectors() {
  if (injectTimer !== null) {
    window.clearTimeout(injectTimer);
  }
  injectTimer = window.setTimeout(() => {
    injectTimer = null;
    runInjectors();
  }, 250);
}

runInjectors();

const observer = new MutationObserver(() => {
  scheduleInjectors();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SP_CONTENT_GET_DOI") {
    sendResponse({ ok: true, doi: spDoiFromCurrentPage() });
    return false;
  }
  return false;
});
