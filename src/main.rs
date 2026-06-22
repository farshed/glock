mod cache;
mod count;
mod git;
mod github;

use std::sync::Arc;
use std::time::Duration;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tempfile::TempDir;

use crate::cache::LocCache;
use crate::count::Counts;
use crate::git::CloneError;

/// Repos larger than this (in KB, per the GitHub API) are cached longer, since
/// they change less often relative to their cost to recount.
const SIZE_THRESHOLD_KB: u64 = 20_000;
/// TTL for large repositories.
const TTL_LARGE: Duration = Duration::from_secs(24 * 60 * 60);
/// TTL for small repositories.
const TTL_SMALL: Duration = Duration::from_secs(5 * 60);

/// Shared application state, cloned cheaply per request.
#[derive(Clone)]
struct AppState {
    cache: Arc<LocCache>,
    http: reqwest::Client,
}

#[derive(Deserialize)]
struct CountRequest {
    /// Repository identifier in `owner/repo` form.
    repo: String,
    /// Optional GitHub personal access token for private repositories.
    #[serde(default)]
    pat: Option<String>,
}

#[derive(Serialize)]
struct CountResponse {
    repo: String,
    #[serde(flatten)]
    counts: Counts,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

/// Errors surfaced by the `/count` handler, each carrying the status it maps to.
enum ApiError {
    BadRequest(String),
    Forbidden(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error) = match self {
            ApiError::BadRequest(e) => (StatusCode::BAD_REQUEST, e),
            ApiError::Forbidden(e) => (StatusCode::FORBIDDEN, e),
            ApiError::Internal(e) => (StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        (status, Json(ErrorResponse { error })).into_response()
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let state = AppState {
        cache: Arc::new(LocCache::new()),
        http: reqwest::Client::new(),
    };
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/privacy-policy", get(privacy_policy))
        .route("/count", post(count_handler))
        .with_state(state);

    let addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:4000".into());
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("failed to bind listener");
    tracing::info!("listening on {addr}");
    axum::serve(listener, app).await.expect("server error");
}

/// Serve the privacy policy page (baked into the binary at compile time).
async fn privacy_policy() -> Html<&'static str> {
    Html(include_str!("privacy_policy.html"))
}

async fn count_handler(
    State(state): State<AppState>,
    Json(req): Json<CountRequest>,
) -> Result<Json<CountResponse>, ApiError> {
    let (owner, repo) = parse_repo(&req.repo)?;
    let owner = owner.to_string();
    let repo = repo.to_string();
    let repo_id = format!("{owner}/{repo}");

    // Serve a recent count without re-cloning.
    if let Some(counts) = state.cache.get(&repo_id) {
        tracing::info!(%repo_id, "cache hit");
        return Ok(Json(CountResponse { repo: repo_id, counts }));
    }

    // Pick the cache TTL from the repo's size: larger repos are cached longer.
    // If the size lookup fails we treat it as small (the shorter TTL).
    let size_kb = github::repo_size(&state.http, &owner, &repo, req.pat.as_deref()).await;
    let ttl = match size_kb {
        Some(kb) if kb > SIZE_THRESHOLD_KB => TTL_LARGE,
        _ => TTL_SMALL,
    };
    tracing::info!(%repo_id, ?size_kb, ttl_secs = ttl.as_secs(), "cache ttl chosen");

    // Clone into a temp dir that is removed when `tmp` is dropped — including on
    // any early return below.
    let tmp = TempDir::new()
        .map_err(|e| ApiError::Internal(format!("could not create temp dir: {e}")))?;
    let checkout = tmp.path().join("repo");

    tracing::info!(%owner, %repo, "cloning");
    match git::shallow_clone(&owner, &repo, req.pat.as_deref(), &checkout).await {
        Ok(()) => {}
        Err(CloneError::Access(msg)) => {
            tracing::warn!(%owner, %repo, "clone denied: {msg}");
            return Err(ApiError::Forbidden(format!(
                "could not access {owner}/{repo} (check that it exists and the token has access)"
            )));
        }
        Err(CloneError::Other(msg)) => {
            tracing::error!(%owner, %repo, "clone failed: {msg}");
            return Err(ApiError::Internal(format!("clone failed: {msg}")));
        }
    }

    let counts = tokio::task::spawn_blocking(move || count::count_lines(&checkout))
        .await
        .map_err(|e| ApiError::Internal(format!("counting task failed: {e}")))?;

    // The cloned repo is no longer needed — delete it before responding.
    drop(tmp);

    state.cache.insert(&repo_id, counts.clone(), ttl);

    Ok(Json(CountResponse {
        repo: repo_id,
        counts,
    }))
}

/// Validate and split an `owner/repo` identifier.
fn parse_repo(input: &str) -> Result<(&str, &str), ApiError> {
    let input = input.trim().trim_end_matches(".git");
    let (owner, repo) = input
        .split_once('/')
        .ok_or_else(|| ApiError::BadRequest("repo must be in 'owner/repo' form".into()))?;

    let valid = |s: &str| {
        !s.is_empty()
            && s.len() <= 100
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if !valid(owner) || !valid(repo) {
        return Err(ApiError::BadRequest(
            "owner and repo may only contain alphanumerics, '-', '_', and '.'".into(),
        ));
    }
    Ok((owner, repo))
}
