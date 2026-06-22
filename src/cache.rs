use std::num::NonZeroUsize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use lru::LruCache;

use crate::count::Counts;

/// Maximum number of repositories held in the cache at once. Past this, the
/// least-recently-used entry is evicted.
const MAX_ENTRIES: usize = 512;

struct Entry {
    counts: Counts,
    /// When this entry stops being valid. TTL is chosen per repository by the
    /// caller, so it is stored on the entry rather than as a global constant.
    expires_at: Instant,
}

/// An in-memory, time-bounded LRU cache of repository line counts.
pub struct LocCache {
    inner: Mutex<LruCache<String, Entry>>,
}

impl LocCache {
    pub fn new() -> Self {
        let cap = NonZeroUsize::new(MAX_ENTRIES).expect("MAX_ENTRIES must be non-zero");
        Self {
            inner: Mutex::new(LruCache::new(cap)),
        }
    }

    /// GitHub repo paths are case-insensitive, so normalize the key.
    fn key(repo: &str) -> String {
        repo.to_lowercase()
    }

    /// Return the cached counts for `repo` if present and not expired, promoting
    /// the entry to most-recently-used. Expired entries are evicted on access.
    pub fn get(&self, repo: &str) -> Option<Counts> {
        let key = Self::key(repo);
        let mut cache = self.inner.lock().unwrap();

        // `peek` reads without changing LRU order; copy out the freshness flag so
        // the borrow ends before we mutate the cache below.
        let expired = match cache.peek(&key) {
            Some(entry) => Instant::now() >= entry.expires_at,
            None => return None,
        };
        if expired {
            cache.pop(&key);
            return None;
        }

        // Fresh: `get` promotes it to most-recently-used.
        cache.get(&key).map(|entry| entry.counts.clone())
    }

    /// Insert or refresh the counts for `repo` with the given time-to-live,
    /// evicting the LRU entry if full.
    pub fn insert(&self, repo: &str, counts: Counts, ttl: Duration) {
        let mut cache = self.inner.lock().unwrap();
        cache.put(
            Self::key(repo),
            Entry {
                counts,
                expires_at: Instant::now() + ttl,
            },
        );
    }
}
