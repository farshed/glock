const $ = (id) => document.getElementById(id);

const DEFAULT_MAX_REPO_KB = 20000;

function flash(msg) {
  const el = $("status");
  el.textContent = msg;
  setTimeout(() => (el.textContent = ""), 2000);
}

async function load() {
  const { pat = "", maxRepoKb = DEFAULT_MAX_REPO_KB } = await chrome.storage.local.get([
    "pat",
    "maxRepoKb",
  ]);
  $("pat").value = pat;
  $("maxRepoMb").value = Math.round(maxRepoKb / 1024);
}

async function save() {
  // Stored in KB to match what the GitHub API reports.
  const mb = Number($("maxRepoMb").value);
  const maxRepoKb = Number.isFinite(mb) && mb > 0
    ? Math.round(mb * 1024)
    : DEFAULT_MAX_REPO_KB;

  await chrome.storage.local.set({ pat: $("pat").value.trim(), maxRepoKb });
  flash("Saved");
}

$("save").addEventListener("click", save);
load();
