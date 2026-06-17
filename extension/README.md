# Glock

A Chrome (MV3) extension that adds a lines-of-code badge next to the repository
name on every GitHub repo page. Counts come from the local **glock** API.

```
torvalds / linux  [ 18,234,567 LOC ]
```

## How it works

1. A content script (`content.js`) detects repo pages, finds the repo-name
   element, and inserts a placeholder badge.
2. It asks the background service worker (`background.js`) for the count via
   `chrome.runtime.sendMessage`.
3. The worker `POST`s `{ "repo": "owner/repo", "pat"?: "…" }` to the glock API's
   `/count` endpoint, caches the result in `chrome.storage.local`, and returns
   the numbers.

The network call runs in the service worker rather than the page. Because the
extension declares `host_permissions` for `localhost`/`127.0.0.1`, that fetch is
exempt from page CORS — so the API needs no CORS headers.

## Setup

1. Start the glock API (defaults to `http://localhost:4000`):
   ```
   cargo run            # from the repo root
   ```
2. Load the extension:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select this `extension/` folder
3. Visit any repo, e.g. `https://github.com/BurntSushi/byteorder`.

The first load of a repo triggers a server-side clone, so the badge shows
`LOC …` for a moment before the count appears. Subsequent views are served from
cache (24 h default).

## Options

Click the extension's toolbar icon (or use **Extension options**) to set:

- **API base URL** — if your API runs somewhere other than `http://localhost:4000`.
  Hosts other than `localhost`/`127.0.0.1` require adding the host to
  `host_permissions` in `manifest.json`.
- **Personal Access Token** — forwarded to the API so it can clone private repos.
  Stored locally in the browser. Private repos without a valid token show `LOC 🔒`.
- **Cache TTL** — hours before a repo is re-fetched (`0` disables caching).
- **Clear cache** — drops all stored counts.
