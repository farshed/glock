(() => {
  const BADGE_ID = "gh-loc-badge";

  // First path segments that are GitHub features, not repo owners.
  const RESERVED_OWNERS = new Set([
    "settings", "notifications", "marketplace", "explore", "topics",
    "sponsors", "collections", "trending", "events", "codespaces", "new",
    "login", "logout", "join", "about", "pricing", "features", "apps",
    "orgs", "organizations", "dashboard", "search", "pulls", "issues",
    "watching", "stars", "gist", "site", "contact", "security", "account",
    "customer-stories", "readme", "home", "nonprofit", "enterprise",
  ]);

  function currentRepo() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
    if (repo.endsWith(".git")) return null;
    return `${owner}/${repo}`;
  }

  const findNav = () => {
    const list = document.querySelector('[data-component="Breadcrumbs"] ol');
    return list || document.querySelector('[data-component="Breadcrumbs"]');
  };

  const ERROR_LABELS = {
    too_large: "Repo too large",
    no_access: "No access",
    rate_limited: "Rate limited",
    network: "GitHub unreachable",
    github_error: "GitHub error",
    download_failed: "Download failed",
    count_failed: "Count failed",
  };

  const fmt = (n) => new Intl.NumberFormat().format(n);

  const fmtSize = (kb) => {
    if (!Number.isFinite(kb) || kb <= 0) return null;
    if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  };

  const fmtEst = (n) =>
    n < 1_000_000
      ? fmt(n)
      : new Intl.NumberFormat("en", { notation: "compact", maximumSignificantDigits: 2 }).format(n);

  const removeBadge = () => document.getElementById(BADGE_ID)?.remove();

  function showBadge(repo, nav, res) {
    // The page may have navigated while the request was in flight.
    if (currentRepo() !== repo || !nav.isConnected) return;

    const existing = document.getElementById(BADGE_ID);
    if (existing) existing.remove();

    // Own <li> at the end of the breadcrumb list; the previous crumb is no
    // longer :last-child, so GitHub paints its "/" separator before the badge.
    const item = document.createElement("li");
    item.id = BADGE_ID;
    item.dataset.repo = repo;
    item.className = "gh-loc-badge-item";

    const badge = document.createElement("span");

    if (res.ok && res.estLoc !== undefined) {
      const size = fmtSize(res.sizeKb);
      badge.className = "gh-loc-badge";
      badge.textContent = `~${fmtEst(res.estLoc)} LOC${size ? ` · ~${size}` : ""}`;
      badge.title = res.est
        ? "Estimated from code file sizes — repo is over the size limit, so it" +
          " was not downloaded and counted exactly." +
          (res.cached ? "\n(cached)" : "")
        : "Estimate — exact count in progress…";
    } else if (res.ok) {
      const size = fmtSize(res.sizeKb);
      badge.className = "gh-loc-badge";
      badge.textContent = `${fmt(res.code)} LOC${size ? ` · ~${size}` : ""}`;
      badge.title =
        `Code: ${fmt(res.code)}\n` +
        `Comments: ${fmt(res.comments)}\n` +
        `Blank: ${fmt(res.blanks)}\n` +
        `Total lines: ${fmt(res.total)}` +
        (size ? `\nEst. size: ${size}` : "") +
        (res.cached ? "\n(cached)" : "");
    } else {
      const size = fmtSize(res.sizeKb);
      badge.className = "gh-loc-badge gh-loc-badge--error";
      badge.textContent =
        res.reason === "too_large" && size
          ? `Too large · ~${size}`
          : ERROR_LABELS[res.reason] || "Unavailable";
      badge.title = res.error || "Could not count this repository";
    }

    item.appendChild(badge);
    nav.appendChild(item);
    centreOnCrumb(badge, nav);
  }

  // Whether the crumb lays out as flex or inline decides which of
  // vertical-align / align-self applies, so measure and correct the remainder.
  function centreOnCrumb(badge, nav) {
    const anchor = nav.querySelector("a") || nav;
    if (anchor === badge) return;

    badge.style.transform = "";
    const target = anchor.getBoundingClientRect();
    const current = badge.getBoundingClientRect();
    if (!target.height || !current.height) return;

    const delta = target.top + target.height / 2 - (current.top + current.height / 2);
    if (Math.abs(delta) > 0.5) badge.style.transform = `translateY(${delta.toFixed(1)}px)`;
  }

  async function inject() {
    const repo = currentRepo();
    const nav = repo ? findNav() : null;
    if (!repo || !nav) {
      removeBadge();
      return;
    }

    const existing = document.getElementById(BADGE_ID);
    if (existing && existing.dataset.repo === repo && existing.parentElement === nav) {
      return;
    }
    if (existing) existing.remove();

    try {
      const res = await chrome.runtime.sendMessage({ type: "getLoc", repo });
      if (res) showBadge(repo, nav, res);
    } catch (_e) {
      // Worker unreachable (e.g. the extension reloaded mid-request).
    }
  }

  // Debounce: SPA re-renders fire many mutations.
  let timer = null;
  function scheduleInject() {
    clearTimeout(timer);
    timer = setTimeout(inject, 250);
  }

  // The exact count arrives after the estimate was answered synchronously.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "locResult" && msg.repo === currentRepo()) {
      const nav = findNav();
      if (nav) showBadge(msg.repo, nav, msg.result);
    }
  });

  document.addEventListener("turbo:load", scheduleInject);
  document.addEventListener("turbo:render", scheduleInject);
  document.addEventListener("pjax:end", scheduleInject);

  // Fallback for navigations the events above miss.
  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  scheduleInject();
})();
