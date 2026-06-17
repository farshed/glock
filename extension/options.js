const $ = (id) => document.getElementById(id);

function flash(msg) {
  const el = $("status");
  el.textContent = msg;
  setTimeout(() => (el.textContent = ""), 2000);
}

async function load() {
  const { pat = "" } = await chrome.storage.local.get("pat");
  $("pat").value = pat;
}

async function save() {
  await chrome.storage.local.set({ pat: $("pat").value.trim() });
  flash("Saved");
}

$("save").addEventListener("click", save);
load();
