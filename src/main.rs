mod count;
mod git;

use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tempfile::TempDir;

use crate::count::Counts;
use crate::git::CloneError;

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

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/count", post(count_handler));

    let addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:4000".into());
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("failed to bind listener");
    tracing::info!("listening on {addr}");
    axum::serve(listener, app).await.expect("server error");
}

async fn count_handler(Json(req): Json<CountRequest>) -> Result<Json<CountResponse>, ApiError> {
    let (owner, repo) = parse_repo(&req.repo)?;
    let owner = owner.to_string();
    let repo = repo.to_string();

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

    Ok(Json(CountResponse {
        repo: format!("{owner}/{repo}"),
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
