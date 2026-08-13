#!/usr/bin/env bun
const repo = process.argv[2];
if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
  console.error("Usage: bun repo-stats.ts <owner>/<repo>");
  process.exit(1);
}

const headers: Record<string, string> = { accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function api(path: string) {
  const resp = await fetch(`https://api.github.com${path}`, { headers });
  if (!resp.ok) {
    console.error(`GitHub API error: HTTP ${resp.status} on ${path}`);
    process.exit(1);
  }
  return resp;
}

const meta = await (await api(`/repos/${repo}`)).json();
const sizeKb: number = meta.size;

// With per_page=1 the number of pages equals the number of branches,
// and the Link header's rel="last" URL carries the page count.
const resp = await api(`/repos/${repo}/branches?per_page=1`);
const last = resp.headers.get("link")?.match(/[?&]page=(\d+)>; rel="last"/);
const branches = last ? Number(last[1]) : (await resp.json()).length;

console.log(`Size: ${sizeKb} KB`);
console.log(`Branches: ${branches}`);
console.log(`Size per branch: ${(sizeKb / branches).toFixed(1)} KB`);
