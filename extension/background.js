import { countTarball } from "./lib/counter.js";

const DEFAULTS = {
  pat: "",
  ttlMinutes: 15,
  // GitHub reports repo size in KB.
  maxRepoKb: 50 * 1024,
};

const LIMIT_MAX_REPO_KB = 500 * 1024;

// Calibrated against tokei's exact counts; code-only bytes cluster at 34–48 per line.
const BYTES_PER_LOC = 40;

const CODE_EXT = new Set([
  "rs", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "java",
  "c", "h", "cpp", "hpp", "cc", "hh", "cs", "php", "swift", "kt", "kts",
  "scala", "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd", "pl",
  "pm", "lua", "r", "jl", "hs", "ml", "mli", "ex", "exs", "erl", "clj",
  "cljs", "el", "vim", "sql", "html", "htm", "css", "scss", "sass", "less",
  "vue", "svelte", "json", "yml", "yaml", "toml", "xml", "ini", "cfg",
  "proto", "cmake", "make", "mk", "makefile", "gradle", "tf", "dockerfile",
  "nix", "zig", "d", "v",
]);

async function getConfig() {
  const stored = await chrome.storage.local.get(["pat", "ttlMinutes", "maxRepoKb"]);
  const cfg = { ...DEFAULTS, ...stored };
  cfg.maxRepoKb = Math.min(cfg.maxRepoKb || DEFAULTS.maxRepoKb, LIMIT_MAX_REPO_KB);
  return cfg;
}

const cacheKey = (repo) => `loc:${repo.toLowerCase()}`;

// Every failure result goes through here so it shows up in the worker console.
function fail(result) {
  console.error(`[glock] ${result.error || result.reason}`, result);
  return result;
}

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "getLoc" && typeof msg.repo === "string") {
    handleGetLoc(msg.repo, sender.tab?.id)
      .then(sendResponse)
      .catch((err) => sendResponse(fail({ ok: false, status: 0, error: String(err) })));
    return true; // keep the message channel open for the async response
  }
  return false;
});

function authHeaders(cfg) {
  const headers = { accept: "application/vnd.github+json" };
  if (cfg.pat) headers.authorization = `Bearer ${cfg.pat}`;
  return headers;
}

function apiError(resp, repo, cfg) {
  // A 403 with no quota left is a rate limit, not a permissions problem.
  if (resp.status === 403 && resp.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(resp.headers.get("x-ratelimit-reset")) * 1000;
    const mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : null;
    return fail({
      ok: false,
      status: resp.status,
      reason: "rate_limited",
      error: `GitHub rate limit reached${mins ? `, resets in ~${mins} min` : ""}.` +
        (cfg.pat ? "" : " Adding a token raises it from 60 to 5,000 requests/hour."),
    });
  }
  if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
    return fail({
      ok: false,
      status: resp.status,
      reason: "no_access",
      error: `Cannot access ${repo} (check that it exists and the token has access)`,
    });
  }
  return fail({ ok: false, status: resp.status, reason: "github_error", error: `HTTP ${resp.status}` });
}

function estimateLoc(tree) {
  let bytes = 0;
  for (const entry of tree) {
    if (entry.type !== "blob") continue;
    const parts = entry.path.split("/");
    if (parts.some((p) => p.startsWith("."))) continue;
    const file = parts[parts.length - 1].toLowerCase();
    const dot = file.lastIndexOf(".");
    const ext = dot > 0 ? file.slice(dot + 1) : file;
    if (CODE_EXT.has(ext)) bytes += entry.size || 0;
  }
  return Math.round(bytes / BYTES_PER_LOC);
}

async function handleGetLoc(repo, tabId) {
  const cfg = await getConfig();
  const key = cacheKey(repo);
  const ttlMs = cfg.ttlMinutes * 60 * 1000;

  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && ttlMs > 0 && Date.now() - cached.at < ttlMs) {
    return { ...cached.result, cached: true };
  }

  const [owner, name] = repo.split("/");

  // Sum of blob sizes in the default branch (HEAD) — the actual checkout size,
  // unlike the metadata endpoint's `size`, which counts the full packed history
  // and over-states it badly. Infinity marks a truncated listing (>100k files).
  let sizeKb;
  let estLoc;
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/trees/HEAD?recursive=1`,
      { headers: authHeaders(cfg) },
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data.truncated) {
        sizeKb = Infinity;
      } else {
        sizeKb = data.tree.reduce((sum, e) => (e.type === "blob" ? sum + (e.size || 0) : sum), 0) / 1024;
        estLoc = estimateLoc(data.tree);
      }
    } else if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
      // Auth and rate-limit problems would hit the metadata call identically.
      return apiError(resp, repo, cfg);
    }
  } catch (e) {
    // Fall through to the metadata call.
    console.warn(`[glock] Tree fetch failed for ${repo}, falling back to metadata:`, e);
  }

  if (sizeKb === undefined) {
    try {
      const resp = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
        headers: authHeaders(cfg),
      });
      if (!resp.ok) return apiError(resp, repo, cfg);
      sizeKb = (await resp.json()).size;
    } catch (e) {
      return fail({ ok: false, status: 0, reason: "network", error: `Cannot reach GitHub: ${e}` });
    }
  }

  if (typeof sizeKb === "number" && sizeKb > cfg.maxRepoKb) {
    // Too large to download — the estimate from the tree is the final answer.
    if (estLoc !== undefined) {
      const result = { ok: true, status: 200, repo, est: true, estLoc, sizeKb };
      await chrome.storage.local.set({ [key]: { at: Date.now(), result } });
      return result;
    }
    return fail({
      ok: false,
      status: 0,
      reason: "too_large",
      sizeKb,
      error: sizeKb === Infinity
        ? `${repo} has too many files to count`
        : `${repo} is ~${Math.round(sizeKb / 1024)}MB, over the ${
            Math.round(cfg.maxRepoKb / 1024)
          }MB limit`,
    });
  }

  const count = async () => {
    const result = await downloadAndCount(cfg, repo, sizeKb);
    if (result.ok) {
      await chrome.storage.local.set({ [key]: { at: Date.now(), result } });
    }
    return result;
  };

  if (estLoc === undefined || tabId === undefined) return count();

  // Answer now with the estimate; push the exact count to the tab when it lands.
  count().then((result) => {
    chrome.tabs.sendMessage(tabId, { type: "locResult", repo, result }).catch((e) => {
      console.warn(`[glock] Could not push exact count to tab ${tabId}:`, e);
    });
  });
  return { ok: true, status: 200, repo, phase: "estimate", estLoc, sizeKb };
}

async function downloadAndCount(cfg, repo, sizeKb) {
  const [owner, name] = repo.split("/");
  const url = `https://codeload.github.com/${owner}/${name}/tar.gz/HEAD`;

  try {
    const resp = await fetch(url, { headers: cfg.pat ? authHeaders(cfg) : {} });
    if (!resp.ok) {
      return fail({
        ok: false,
        status: resp.status,
        reason: "download_failed",
        error: `Tarball fetch failed: HTTP ${resp.status}`,
      });
    }
    const counts = await countTarball(resp.body);
    return { ok: true, status: 200, repo, sizeKb, ...counts };
  } catch (e) {
    return fail({ ok: false, status: 0, reason: "count_failed", error: `Count failed: ${e}` });
  }
}
