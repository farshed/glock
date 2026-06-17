use std::path::Path;

use serde::Serialize;
use tokei::{Config, Languages};

/// Aggregated line counts for a repository, as reported by tokei.
#[derive(Serialize)]
pub struct Counts {
    /// Lines of actual code — the headline number.
    pub code: usize,
    pub comments: usize,
    pub blanks: usize,
    /// `code + comments + blanks`.
    pub total: usize,
}

/// Run tokei over `path` and aggregate the totals across every detected language.
///
/// This is CPU-bound and walks the filesystem, so callers should invoke it from
/// a blocking context (e.g. `tokio::task::spawn_blocking`).
pub fn count_lines(path: &Path) -> Counts {
    let config = Config::default();
    let mut languages = Languages::new();
    languages.get_statistics(&[path], &[], &config);

    let total = languages.total();
    Counts {
        code: total.code,
        comments: total.comments,
        blanks: total.blanks,
        total: total.code + total.comments + total.blanks,
    }
}
