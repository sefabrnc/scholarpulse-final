importScripts("../lib/config.js", "../lib/doi.js", "../lib/api.js");

const BADGE_CACHE_TTL_MS = 5 * 60 * 1000;
/** @type {Map<string, { expiresAt: number; payload: Record<string, unknown> }>} */
const badgeCache = new Map();

/**
 * @returns {Promise<SpExtensionConfig>}
 */
async function loadConfig() {
  const stored = await chrome.storage.sync.get([
    SP_STORAGE_KEYS.apiBaseUrl,
    SP_STORAGE_KEYS.webBaseUrl,
    SP_STORAGE_KEYS.userId
  ]);

  return spMergeConfig({
    apiBaseUrl: stored[SP_STORAGE_KEYS.apiBaseUrl],
    webBaseUrl: stored[SP_STORAGE_KEYS.webBaseUrl],
    userId: stored[SP_STORAGE_KEYS.userId]
  });
}

/**
 * @param {string} doi
 * @param {boolean} force
 * @returns {Promise<Record<string, unknown>>}
 */
async function getBadgeForDoi(doi, force) {
  const normalized = spNormalizeDoi(doi);
  if (!normalized) {
    throw new Error("Invalid DOI");
  }

  const cached = badgeCache.get(normalized);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const config = await loadConfig();
  const payload = await spFetchPaperBadge(config, normalized);
  badgeCache.set(normalized, {
    expiresAt: Date.now() + BADGE_CACHE_TTL_MS,
    payload
  });

  return payload;
}

/**
 * @param {number | undefined} tabId
 * @returns {Promise<string | null>}
 */
async function doiFromTabId(tabId) {
  if (!tabId) {
    return null;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "SP_CONTENT_GET_DOI" });
    if (response?.ok && typeof response.doi === "string") {
      return spNormalizeDoi(response.doi);
    }
  } catch {
    const tab = await chrome.tabs.get(tabId);
    const fromUrl = spDoiFromHref(tab.url || "");
    if (fromUrl) {
      return fromUrl;
    }
  }

  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;

  if (type === "SP_GET_CONFIG") {
    loadConfig()
      .then((config) => sendResponse({ ok: true, config }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (type === "SP_SAVE_CONFIG") {
    const next = spMergeConfig(message.config || {});
    chrome.storage.sync
      .set({
        [SP_STORAGE_KEYS.apiBaseUrl]: next.apiBaseUrl,
        [SP_STORAGE_KEYS.webBaseUrl]: next.webBaseUrl,
        [SP_STORAGE_KEYS.userId]: next.userId
      })
      .then(() => sendResponse({ ok: true, config: next }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (type === "SP_FETCH_BADGE") {
    getBadgeForDoi(message.doi, Boolean(message.force))
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (type === "SP_ADD_TO_LIBRARY") {
    loadConfig()
      .then(async (config) => {
        const doi = spNormalizeDoi(message.doi) || (await doiFromTabId(sender.tab?.id));
        if (!doi) {
          throw new Error("No DOI found on this page.");
        }
        const payload = await spAddDoiToLibrary(config, doi);
        return { doi, payload };
      })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (type === "SP_GET_ACTIVE_DOI") {
    const tabId = message.tabId || sender.tab?.id;
    doiFromTabId(tabId)
      .then((doi) => sendResponse({ ok: true, doi }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
