// Service worker: owns all network access and caching. Content scripts ask it
// for a repo's LOC count via runtime messaging. Because the extension holds
// host_permissions for the API host, these fetches are exempt from page CORS,
// so the glock API needs no CORS headers of its own.

const DEFAULTS = {
  apiBase: "https://glock.farshed.me",
  pat: "",
  ttlHours: 24,
};

async function getConfig() {
  const stored = await chrome.storage.local.get(["apiBase", "pat", "ttlHours"]);
  return { ...DEFAULTS, ...stored };
}

const cacheKey = (repo) => `loc:${repo.toLowerCase()}`;

// Clicking the toolbar icon opens the options page (no popup configured).
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "getLoc" && typeof msg.repo === "string") {
    handleGetLoc(msg.repo)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, status: 0, error: String(err) }));
    return true; // keep the message channel open for the async response
  }
  return false;
});

async function handleGetLoc(repo) {
  const cfg = await getConfig();
  const key = cacheKey(repo);
  const ttlMs = cfg.ttlHours * 3600 * 1000;

  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && ttlMs > 0 && Date.now() - cached.at < ttlMs) {
    return { ...cached.result, cached: true };
  }

  const result = await fetchLoc(cfg, repo);
  // Only cache successes; transient failures should be retried next time.
  if (result.ok) {
    await chrome.storage.local.set({ [key]: { at: Date.now(), result } });
  }
  return result;
}

async function fetchLoc(cfg, repo) {
  const base = cfg.apiBase.replace(/\/+$/, "");
  const body = { repo };
  if (cfg.pat) body.pat = cfg.pat;

  let resp;
  try {
    resp = await fetch(`${base}/count`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_e) {
    return { ok: false, status: 0, error: `Cannot reach the LOC API at ${base}` };
  }

  let data = null;
  try {
    data = await resp.json();
  } catch (_e) {
    // non-JSON body; fall back to status text below
  }

  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      error: (data && data.error) || `HTTP ${resp.status}`,
    };
  }

  return {
    ok: true,
    status: 200,
    repo: data.repo,
    code: data.code,
    comments: data.comments,
    blanks: data.blanks,
    total: data.total,
  };
}
