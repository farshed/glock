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

  // The badge goes inside the final crumb, not alongside it: GitHub draws the
  // "/" separators with a pseudo-element on each list item, so a direct child of
  // the <ol> stops the last crumb being :last-child and paints a stray slash.
  const findNav = () => {
    const list = document.querySelector('[data-component="Breadcrumbs"] ol');
    if (list) return list.querySelector("li:last-of-type") || list;
    return document.querySelector('[data-component="Breadcrumbs"]');
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

  const removeBadge = () => document.getElementById(BADGE_ID)?.remove();

  function showBadge(repo, nav, res) {
    // The page may have navigated while the request was in flight.
    if (currentRepo() !== repo || !nav.isConnected) return;

    const existing = document.getElementById(BADGE_ID);
    if (existing) existing.remove();

    const badge = document.createElement("span");
    badge.id = BADGE_ID;
    badge.dataset.repo = repo;

    if (res.ok) {
      badge.className = "gh-loc-badge";
      badge.textContent = `${fmt(res.code)} LOC`;
      badge.title =
        `Code: ${fmt(res.code)}\n` +
        `Comments: ${fmt(res.comments)}\n` +
        `Blank: ${fmt(res.blanks)}\n` +
        `Total lines: ${fmt(res.total)}` +
        (res.cached ? "\n(cached)" : "");
    } else {
        badge.className = "gh-loc-badge gh-loc-badge--error";
      badge.textContent = ERROR_LABELS[res.reason] || "Unavailable";
      badge.title = res.error || "Could not count this repository";
    }

    nav.appendChild(badge);
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

  document.addEventListener("turbo:load", scheduleInject);
  document.addEventListener("turbo:render", scheduleInject);
  document.addEventListener("pjax:end", scheduleInject);

  // Fallback for navigations the events above miss.
  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  scheduleInject();
})();
