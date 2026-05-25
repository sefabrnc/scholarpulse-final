# ScholarPulse Browser Extension (MV3)

Chrome/Firefox extension for Phase 1 parity:

- DOI / Scholar / PubMed row badges via `GET /api/papers/:doi/badge`
- Popup: detected DOI, badge preview, add to library, open in web app
- Configurable API + web base URLs in popup (`chrome.storage.sync`)

## Load unpacked

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked -> select `extensions/browser`

## Layout

| Path | Role |
|---|---|
| `manifest.json` | MV3 manifest (content + service worker + popup) |
| `background/service-worker.js` | Badge cache + library add proxy |
| `content/content.js` | Scholar/PubMed/DOI badge injection |
| `content/content.css` | Inline badge styles |
| `popup/popup.html` | Popup UI |
| `lib/doi.js` | DOI normalize/extract helpers |
| `lib/api.js` | Worker API fetch helpers |
| `lib/config.js` | Default + storage keys |

Legacy root `content.js` / `background.js` / `popup.js` are deprecated; manifest points at the structured paths above.

## Popup error handling

- Network/API failures surface user-readable messages (unreachable API, 404 paper, auth errors).
- `chrome.runtime.lastError` is checked on every message round-trip.
- Content-script badges show a compact error pill instead of silent failure.

## Next steps

- Supabase OAuth via `chrome.identity` (replace manual x-user-id)
- Zotero connector parity (Phase 2)
