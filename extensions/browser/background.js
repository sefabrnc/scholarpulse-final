const DEFAULT_API_BASE = "http://127.0.0.1:8787";

async function getApiBase() {
  const stored = await chrome.storage.sync.get(["apiBase"]);
  return typeof stored.apiBase === "string" && stored.apiBase.trim().length > 0
    ? stored.apiBase.trim()
    : DEFAULT_API_BASE;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "fetch-badge") {
    return false;
  }
  void (async () => {
    try {
      const apiBase = await getApiBase();
      const doi = String(message.doi || "").trim();
      if (!doi) {
        sendResponse({ ok: false, error: "missing_doi" });
        return;
      }
      const response = await fetch(`${apiBase}/api/papers/${encodeURIComponent(doi)}/badge`, {
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        sendResponse({ ok: false, error: `http_${response.status}` });
        return;
      }
      const payload = await response.json();
      sendResponse({ ok: true, payload });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "fetch_failed" });
    }
  })();
  return true;
});
