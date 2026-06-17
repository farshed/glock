// Injects a lines-of-code badge next to the repository name on GitHub repo
// pages. GitHub navigates as a SPA (Turbo), so we re-run on navigation as well
// as on initial load.

(() => {
  const BADGE_ID = "gh-loc-badge";

  // First path segment values that are GitHub features, not repo owners.
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

  // The element the badge is inserted after. Prefer the repo-name link in the
  // global top header (the "owner / repo" breadcrumb at the very top), falling
  // back to the large repo title in the page body. Multiple selectors since
  // GitHub's markup shifts over time.
  const findNav = () =>
    document.querySelector('[data-component="Breadcrumbs"] ol') ||
    document.querySelector('[data-component="Breadcrumbs"]');

  const fmt = (n) => new Intl.NumberFormat().format(n);

  const removeBadge = () => document.getElementById(BADGE_ID)?.remove();

  function showBadge(repo, nav, res) {
    // The page may have navigated while the request was in flight.
    if (currentRepo() !== repo || !nav.isConnected) return;

    const existing = document.getElementById(BADGE_ID);
    if (existing) existing.remove();

    const badge = document.createElement("span");
    badge.id = BADGE_ID;
    badge.className = "gh-loc-badge";
    badge.dataset.repo = repo;
    badge.textContent = `${fmt(res.code)} LOC`;
    badge.title =
      `Code: ${fmt(res.code)}\n` +
      `Comments: ${fmt(res.comments)}\n` +
      `Blank: ${fmt(res.blanks)}\n` +
      `Total lines: ${fmt(res.total)}` +
      (res.cached ? "\n(cached)" : "");
    nav.appendChild(badge);
  }

  async function inject() {
    const repo = currentRepo();
    const nav = repo ? findNav() : null;
    if (!repo || !nav) {
      removeBadge();
      return;
    }

    // Already showing the right repo's badge in the breadcrumbs? Leave it.
    const existing = document.getElementById(BADGE_ID);
    if (existing && existing.dataset.repo === repo && existing.parentElement === nav) {
      return;
    }
    // Stale badge from a previous repo — drop it until we have fresh numbers.
    if (existing) existing.remove();

    // Only ever render the badge once we actually have a line count. Pending
    // requests and failures show nothing at all.
    try {
      const res = await chrome.runtime.sendMessage({ type: "getLoc", repo });
      if (res && res.ok && typeof res.code === "number") {
        showBadge(repo, nav, res);
      }
    } catch (_e) {
      // swallow — no badge on failure
    }
  }

  // Debounce so SPA re-renders (which fire many mutations) trigger one inject.
  let timer = null;
  function scheduleInject() {
    clearTimeout(timer);
    timer = setTimeout(inject, 250);
  }

  // Turbo / pjax navigation events.
  document.addEventListener("turbo:load", scheduleInject);
  document.addEventListener("turbo:render", scheduleInject);
  document.addEventListener("pjax:end", scheduleInject);

  // Fallback: observe DOM changes for navigations not covered by the events.
  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  scheduleInject();
})();
