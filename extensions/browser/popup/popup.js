const doiInput = document.getElementById("sp-doi");
const badgePanel = document.getElementById("sp-badge-panel");
const badgeStats = document.getElementById("sp-badge-stats");
const statusEl = document.getElementById("sp-status");
const addBtn = document.getElementById("sp-add-btn");
const openBtn = document.getElementById("sp-open-btn");
const apiBaseInput = document.getElementById("sp-api-base");
const webBaseInput = document.getElementById("sp-web-base");
const userIdInput = document.getElementById("sp-user-id");
const saveConfigBtn = document.getElementById("sp-save-config");

/** @type {SpExtensionConfig} */
let activeConfig = spMergeConfig({});

/**
 * @param {string} message
 * @param {"info" | "error" | "success"} tone
 */
function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.classList.remove("error", "success");
  if (tone === "error") {
    statusEl.classList.add("error");
  }
  if (tone === "success") {
    statusEl.classList.add("success");
  }
}

/**
 * @param {string | null | undefined} message
 * @returns {string}
 */
function humanizePopupError(message) {
  const text = String(message || "").trim();
  if (!text) {
    return "Request failed. Check API settings and try again.";
  }
  if (/Set a user ID/i.test(text)) {
    return text;
  }
  if (/failed to fetch|networkerror|fetch_failed/i.test(text)) {
    return "Cannot reach API. Verify API base URL and that the Worker is running.";
  }
  if (/http_404|not found|404/i.test(text)) {
    return "Paper not found in ScholarPulse yet.";
  }
  if (/http_401|http_403|401|403/i.test(text)) {
    return "Unauthorized. Check user ID (x-user-id) in settings.";
  }
  if (/http_502|http_503|http_504/i.test(text)) {
    return "ScholarPulse API is temporarily unavailable.";
  }
  if (/Invalid DOI|missing_doi/i.test(text)) {
    return "No valid DOI on this page.";
  }
  return text;
}

/**
 * @param {Record<string, unknown>} message
 * @returns {Promise<Record<string, unknown>>}
 */
function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || {});
    });
  });
}

/**
 * @param {Record<string, unknown>} payload
 */
function renderBadge(payload) {
  const rows = [
    ["Citations", payload.citation_count ?? 0],
    ["Influential", payload.influential_count ?? 0],
    ["Supports", payload.supports ?? 0],
    ["Contradicts", payload.contradicts ?? 0],
    ["Extends", payload.extends ?? 0],
    ["Method", payload.method ?? 0]
  ];

  badgeStats.innerHTML = rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${String(value)}</dd>`)
    .join("");

  badgePanel.classList.remove("hidden");
}

async function loadConfig() {
  try {
    const response = await sendRuntimeMessage({ type: "SP_GET_CONFIG" });
    if (!response.ok) {
      setStatus(humanizePopupError(response.error), "error");
      return;
    }

    activeConfig = response.config;
    apiBaseInput.value = activeConfig.apiBaseUrl;
    webBaseInput.value = activeConfig.webBaseUrl;
    userIdInput.value = activeConfig.userId;
  } catch (error) {
    setStatus(humanizePopupError(error instanceof Error ? error.message : null), "error");
  }
}

async function loadActiveDoi() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    const response = await sendRuntimeMessage({ type: "SP_GET_ACTIVE_DOI", tabId });
    const doi = response.ok ? spNormalizeDoi(response.doi) : null;
    doiInput.value = doi || "";

    if (!doi) {
      addBtn.disabled = true;
      openBtn.disabled = true;
      badgePanel.classList.add("hidden");
      setStatus("No DOI detected on the active tab.", "info");
      return;
    }

    addBtn.disabled = false;
    openBtn.disabled = false;
    setStatus("Loading badge…", "info");

    const badgeResponse = await sendRuntimeMessage({ type: "SP_FETCH_BADGE", doi });
    if (!badgeResponse.ok) {
      badgePanel.classList.add("hidden");
      setStatus(humanizePopupError(badgeResponse.error), "error");
      return;
    }

    renderBadge(badgeResponse.payload);
    setStatus("", "info");
  } catch (error) {
    badgePanel.classList.add("hidden");
    setStatus(humanizePopupError(error instanceof Error ? error.message : null), "error");
  }
}

addBtn.addEventListener("click", async () => {
  const doi = spNormalizeDoi(doiInput.value);
  if (!doi) {
    setStatus("No DOI to add.", "error");
    return;
  }

  addBtn.disabled = true;
  setStatus("Adding to library…", "info");

  try {
    const response = await sendRuntimeMessage({ type: "SP_ADD_TO_LIBRARY", doi });
    if (!response.ok) {
      setStatus(humanizePopupError(response.error), "error");
      return;
    }
    setStatus(`Added ${response.doi} to library.`, "success");
  } catch (error) {
    setStatus(humanizePopupError(error instanceof Error ? error.message : null), "error");
  } finally {
    addBtn.disabled = false;
  }
});

openBtn.addEventListener("click", () => {
  const doi = spNormalizeDoi(doiInput.value);
  if (!doi) {
    return;
  }
  const url = `${activeConfig.webBaseUrl.replace(/\/+$/, "")}/paper/${encodeURIComponent(doi)}`;
  chrome.tabs.create({ url });
});

saveConfigBtn.addEventListener("click", async () => {
  const next = spMergeConfig({
    apiBaseUrl: apiBaseInput.value.trim(),
    webBaseUrl: webBaseInput.value.trim(),
    userId: userIdInput.value.trim()
  });

  saveConfigBtn.disabled = true;
  try {
    const response = await sendRuntimeMessage({ type: "SP_SAVE_CONFIG", config: next });
    if (!response.ok) {
      setStatus(humanizePopupError(response.error), "error");
      return;
    }

    activeConfig = response.config;
    setStatus("Settings saved.", "success");
    await loadActiveDoi();
  } catch (error) {
    setStatus(humanizePopupError(error instanceof Error ? error.message : null), "error");
  } finally {
    saveConfigBtn.disabled = false;
  }
});

loadConfig();
loadActiveDoi();
