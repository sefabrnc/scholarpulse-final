/**
 * @param {SpExtensionConfig} config
 * @param {string} doi
 * @returns {Promise<Record<string, unknown>>}
 */
async function spFetchPaperBadge(config, doi) {
  const encoded = encodeURIComponent(doi);
  const url = `${config.apiBaseUrl.replace(/\/+$/, "")}/api/papers/${encoded}/badge`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `Badge request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

/**
 * Adds a single DOI via POST /api/library/add.
 *
 * @param {SpExtensionConfig} config
 * @param {string} doi
 * @returns {Promise<Record<string, unknown>>}
 */
async function spAddDoiToLibrary(config, doi) {
  if (!config.userId) {
    throw new Error("Set a user ID in extension settings before adding to library.");
  }

  const url = `${config.apiBaseUrl.replace(/\/+$/, "")}/api/library/add`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-user-id": config.userId
    },
    body: JSON.stringify({ doi })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `Library add failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

/**
 * @param {string} doi
 * @param {SpExtensionConfig} config
 * @returns {string}
 */
function spPaperWebUrl(doi, config) {
  return `${config.webBaseUrl.replace(/\/+$/, "")}/paper/${encodeURIComponent(doi)}`;
}

if (typeof globalThis !== "undefined") {
  globalThis.spFetchPaperBadge = spFetchPaperBadge;
  globalThis.spAddDoiToLibrary = spAddDoiToLibrary;
  globalThis.spPaperWebUrl = spPaperWebUrl;
}
