use std::path::Path;
use std::process::Stdio;

use tokio::process::Command;

/// Outcome of attempting to clone a repository.
pub enum CloneError {
    /// The clone failed because of an authentication / authorization / not-found
    /// problem. These all map to a 403 for the caller (private repos report as
    /// "not found" to avoid leaking their existence).
    Access(String),
    /// The clone failed for some other reason (network, git missing, disk, ...).
    Other(String),
}

/// Shallow-clone `owner/repo` from GitHub into `dest`.
///
/// When a `pat` is supplied it is embedded as the basic-auth username, which
/// GitHub accepts for classic, fine-grained, and installation tokens alike.
pub async fn shallow_clone(
    owner: &str,
    repo: &str,
    pat: Option<&str>,
    dest: &Path,
) -> Result<(), CloneError> {
    let url = match pat {
        Some(token) => format!("https://{token}@github.com/{owner}/{repo}.git"),
        None => format!("https://github.com/{owner}/{repo}.git"),
    };

    let output = Command::new("git")
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg("--no-tags")
        .arg("--single-branch")
        .arg(&url)
        .arg(dest)
        // Never block on an interactive credential prompt: fail fast instead so
        // a private repo without valid auth returns an error rather than hanging.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "")
        .env("GCM_INTERACTIVE", "never")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| CloneError::Other(format!("failed to spawn git: {e}")))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if is_access_failure(&stderr) {
        Err(CloneError::Access(redact(&stderr, pat)))
    } else {
        Err(CloneError::Other(redact(&stderr, pat)))
    }
}

/// Heuristically decide whether git's stderr indicates an auth/permission/not-found
/// failure as opposed to an unrelated error.
fn is_access_failure(stderr: &str) -> bool {
    let s = stderr.to_lowercase();
    const MARKERS: &[&str] = &[
        "authentication failed",
        "could not read username",
        "could not read password",
        "terminal prompts disabled",
        "permission denied",
        "invalid username or password",
        "repository not found",
        "remote: not found",
        "403 forbidden",
        "access denied",
        "requested url returned error: 403",
        "requested url returned error: 401",
        "requested url returned error: 404",
    ];
    MARKERS.iter().any(|m| s.contains(m))
}

/// Strip the PAT out of any message before it leaves the process.
fn redact(msg: &str, pat: Option<&str>) -> String {
    match pat {
        Some(token) if !token.is_empty() => msg.replace(token, "***"),
        _ => msg.to_string(),
    }
}
