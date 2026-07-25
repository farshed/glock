//! Filesystem-free line counting for the browser extension.
//!
//! The host allocates buffers with `alloc`, writes into linear memory, then
//! calls `count` with an out-pointer for the results.

use std::io::Read;
use std::path::Path;

use encoding_rs_io::DecodeReaderBytesBuilder;
use tokei::{Config, LanguageType};

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` must come from [`alloc`] with the same `len`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(unsafe { Vec::from_raw_parts(ptr, 0, len) });
}

/// Writes `[code, comments, blanks]` to `out`. Returns 0, or -1 when the path
/// maps to no known language.
///
/// # Safety
/// All pointers must be valid for the given lengths, and `out` must have room
/// for three `u32`s.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn count(
    path_ptr: *const u8,
    path_len: usize,
    buf_ptr: *const u8,
    buf_len: usize,
    out: *mut u32,
) -> i32 {
    let config = Config::default();
    let path = String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(path_ptr, path_len) });
    let path = Path::new(path.as_ref());
    let body = unsafe { std::slice::from_raw_parts(buf_ptr, buf_len) };

    // `from_path` resolves extensionless paths by opening the file to read its
    // shebang, which cannot work here. Redo that against the bytes we hold —
    // but only for a path with no extension, matching tokei: an unrecognised
    // extension is not a shebang candidate.
    let language = match LanguageType::from_path(path, &config) {
        Some(language) => language,
        None if path.extension().is_none() => match LanguageType::from_shebang_slice(body) {
            Some(language) => language,
            None => return -1,
        },
        None => return -1,
    };

    // tokei pipes files through this decoder before counting; raw bytes
    // miscount every BOM-prefixed or UTF-16 source.
    let mut decoded = Vec::with_capacity(body.len());
    let text = match DecodeReaderBytesBuilder::new().build(body).read_to_end(&mut decoded) {
        Ok(_) => &decoded[..],
        Err(_) => body,
    };

    // `summarise` folds in embedded languages (code blocks in Markdown,
    // <script>/<style> in HTML), as the directory walker does internally.
    let stats = language.parse_from_slice(text, &config).summarise();

    unsafe {
        *out.add(0) = stats.code as u32;
        *out.add(1) = stats.comments as u32;
        *out.add(2) = stats.blanks as u32;
    }
    0
}
