const $ = (id) => document.getElementById(id);

const DEFAULT_MAX_REPO_MB = 50;
const LIMIT_MAX_REPO_MB = 500;

function flash(msg) {
  const el = $("status");
  el.textContent = msg;
  setTimeout(() => (el.textContent = ""), 2000);
}

async function load() {
  const { pat = "", maxRepoKb } = await chrome.storage.local.get(["pat", "maxRepoKb"]);
  $("pat").value = pat;
  $("maxRepoMb").value = maxRepoKb ? Math.round(maxRepoKb / 1024) : DEFAULT_MAX_REPO_MB;
}

async function save() {
  const mb = Number($("maxRepoMb").value);
  const clamped = Number.isFinite(mb) && mb > 0
    ? Math.min(mb, LIMIT_MAX_REPO_MB)
    : DEFAULT_MAX_REPO_MB;

  // Stored in KB to match what the GitHub API reports.
  await chrome.storage.local.set({
    pat: $("pat").value.trim(),
    maxRepoKb: clamped * 1024,
  });

  $("maxRepoMb").value = clamped;
  flash(clamped < mb ? `Saved – capped at ${LIMIT_MAX_REPO_MB} MB` : "Saved");
}

$("save").addEventListener("click", save);
load();
