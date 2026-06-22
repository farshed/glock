use serde::Deserialize;

#[derive(Deserialize)]
struct RepoInfo {
    /// Repository size in kilobytes, as reported by the GitHub API.
    size: u64,
}

/// Look up a repository's size (in KB) via the GitHub REST API.
///
/// Returns `None` on any failure (network error, rate limit, missing repo, bad
/// JSON) — callers should fall back to a default rather than treating this as
/// fatal, since the clone itself is the source of truth for accessibility.
pub async fn repo_size(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    pat: Option<&str>,
) -> Option<u64> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}");
    let mut req = client
        .get(&url)
        .header("User-Agent", "glock") // GitHub rejects requests without a UA
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = pat {
        req = req.bearer_auth(token);
    }

    let resp = req.send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let info: RepoInfo = resp.json().await.ok()?;
    Some(info.size)
}
