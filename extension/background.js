// Service worker: fetches repository tarballs from GitHub and counts them
// locally with tokei compiled to wasm.

import { countTarball } from "./lib/counter.js";

const DEFAULTS = {
  pat: "",
  ttlMinutes: 30,
  // GitHub reports repo size in KB.
  maxRepoKb: 20000,
};

async function getConfig() {
  const stored = await chrome.storage.local.get(["pat", "ttlMinutes", "maxRepoKb"]);
  return { ...DEFAULTS, ...stored };
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
  // Only cache successes; transient failures should be retried next time.
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

  // One metadata request gives both the size and the default branch.
  let meta;
  try {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: authHeaders(cfg),
    });
    if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
      return {
        ok: false,
        status: resp.status,
        error: `Cannot access ${repo} (check that it exists and the token has access)`,
      };
    }
    if (!resp.ok) return { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
    meta = await resp.json();
  } catch (e) {
    return { ok: false, status: 0, error: `Cannot reach GitHub: ${e}` };
  }

  if (typeof meta.size === "number" && meta.size > cfg.maxRepoKb) {
    return {
      ok: false,
      status: 0,
      tooLarge: true,
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
        error: `Tarball fetch failed: HTTP ${resp.status}`,
      };
    }
    const counts = await countTarball(resp.body);
    return { ok: true, status: 200, repo, ...counts };
  } catch (e) {
    return { ok: false, status: 0, error: `Count failed: ${e}` };
  }
}
