import { countTarball } from "./lib/counter.js";

const DEFAULTS = {
  pat: "",
  ttlMinutes: 30,
  // GitHub reports repo size in KB.
  maxRepoKb: 50 * 1024,
};

const LIMIT_MAX_REPO_KB = 500 * 1024;

async function getConfig() {
  const stored = await chrome.storage.local.get(["pat", "ttlMinutes", "maxRepoKb"]);
  const cfg = { ...DEFAULTS, ...stored };
  cfg.maxRepoKb = Math.min(cfg.maxRepoKb || DEFAULTS.maxRepoKb, LIMIT_MAX_REPO_KB);
  return cfg;
}

const cacheKey = (repo) => `loc:${repo.toLowerCase()}`;

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
  const ttlMs = cfg.ttlMinutes * 60 * 1000;

  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && ttlMs > 0 && Date.now() - cached.at < ttlMs) {
    return { ...cached.result, cached: true };
  }

  const result = await countRepo(cfg, repo);
  if (result.ok) {
    await chrome.storage.local.set({ [key]: { at: Date.now(), result } });
  }
  return result;
}

function authHeaders(cfg) {
  const headers = { accept: "application/vnd.github+json" };
  if (cfg.pat) headers.authorization = `Bearer ${cfg.pat}`;
  return headers;
}

async function countRepo(cfg, repo) {
  const [owner, name] = repo.split("/");

  let meta;
  try {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: authHeaders(cfg),
    });
    // A 403 with no quota left is a rate limit, not a permissions problem.
    if (resp.status === 403 && resp.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(resp.headers.get("x-ratelimit-reset")) * 1000;
      const mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : null;
      return {
        ok: false,
        status: resp.status,
        reason: "rate_limited",
        error: `GitHub rate limit reached${mins ? `, resets in ~${mins} min` : ""}.` +
          (cfg.pat ? "" : " Adding a token raises it from 60 to 5,000 requests/hour."),
      };
    }
    if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
      return {
        ok: false,
        status: resp.status,
        reason: "no_access",
        error: `Cannot access ${repo} (check that it exists and the token has access)`,
      };
    }
    if (!resp.ok) {
      return { ok: false, status: resp.status, reason: "github_error", error: `HTTP ${resp.status}` };
    }
    meta = await resp.json();
  } catch (e) {
    return { ok: false, status: 0, reason: "network", error: `Cannot reach GitHub: ${e}` };
  }

  if (typeof meta.size === "number" && meta.size > cfg.maxRepoKb) {
    return {
      ok: false,
      status: 0,
      reason: "too_large",
      error: `${repo} is ~${Math.round(meta.size / 1024)}MB, over the ${
        Math.round(cfg.maxRepoKb / 1024)
      }MB limit`,
    };
  }

  const ref = meta.default_branch || "HEAD";
  const url = `https://codeload.github.com/${owner}/${name}/tar.gz/${ref}`;

  try {
    const resp = await fetch(url, { headers: cfg.pat ? authHeaders(cfg) : {} });
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        reason: "download_failed",
        error: `Tarball fetch failed: HTTP ${resp.status}`,
      };
    }
    const counts = await countTarball(resp.body);
    return { ok: true, status: 200, repo, ...counts };
  } catch (e) {
    return { ok: false, status: 0, reason: "count_failed", error: `Count failed: ${e}` };
  }
}
