function extractDoiFromLocation() {
  const href = window.location.href;
  const match = href.match(/10\.\d{4,9}\/[^\s#?]+/i);
  return match ? match[0].toLowerCase() : null;
}

function renderBadge(root, payload) {
  const supports = payload?.intent_counts?.supports ?? 0;
  const contradicts = payload?.intent_counts?.contradicts ?? 0;
  const influential = payload?.influential_count ?? 0;
  const citationCount = payload?.citation_count ?? 0;

  root.innerHTML = "";
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:99999;background:#111827;color:#fff;padding:10px 12px;border-radius:10px;font:12px/1.4 sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)";
  panel.innerHTML = `
    <strong>ScholarPulse</strong><br/>
    Citations: ${citationCount}<br/>
    Influential: ${influential}<br/>
    Supports: ${supports} · Contradicts: ${contradicts}
  `;
  const button = document.createElement("button");
  button.textContent = "Add to library";
  button.style.cssText = "margin-top:8px;border:0;border-radius:6px;padding:4px 8px;cursor:pointer";
  button.addEventListener("click", () => {
    window.open(`http://localhost:3000/paper/${encodeURIComponent(extractDoiFromLocation() || "")}`, "_blank");
  });
  panel.appendChild(button);
  root.appendChild(panel);
}

function mount() {
  const doi = extractDoiFromLocation();
  if (!doi) {
    return;
  }
  const root = document.createElement("div");
  root.id = "scholarpulse-extension-root";
  document.documentElement.appendChild(root);

  chrome.runtime.sendMessage({ type: "fetch-badge", doi }, (response) => {
    if (response?.ok) {
      renderBadge(root, response.payload);
      return;
    }
    renderBadge(root, { citation_count: 0, influential_count: 0, intent_counts: { supports: 0, contradicts: 0 } });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
