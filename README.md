<div align="center">
  <img src="assets/glock_logo_optimized.png" alt="Glock logo" width="200" />
  <h1>Glock</h1>
  <p>GitHub lines-of-code counter.</p>
</div>

---

Glock is a chrome extension that displays LOC on GitHub repos. It uses [tokei](https://github.com/XAMPPRocky/tokei) for counting.

Counting runs entirely in the browser: the extension downloads the repository
archive from GitHub and counts it with tokei compiled to WebAssembly. Nothing –
including your access token – is sent anywhere except GitHub.

## Layout

| Path         | What it is                                                    |
| ------------ | ------------------------------------------------------------- |
| `extension/` | The Chrome extension. See `extension/README.md`.               |
| `src/`       | Thin Rust shim exposing tokei's counting core to JavaScript.   |
| `scripts/`   | `build-wasm.sh` builds the module, `package.sh` zips the ext.  |

## Building

```
rustup target add wasm32-unknown-unknown   # once
./scripts/build-wasm.sh                    # writes extension/tokei.wasm
```

## Why tokei comes from a fork

tokei 14 doesn't build for wasm. `term_size` uses libc ioctls that don't exist
there, and `etcetera` depends on `home`, which only supports Windows and Unix.
Neither is needed by the library – they're only used by tokei's CLI.

[Our fork](https://github.com/farshed/tokei) makes them optional and adds
`LanguageType::from_shebang_slice`, so files with no extension can be identified
without opening them. `Cargo.toml` points at it with `[patch.crates-io]`, and
`Cargo.lock` pins the exact commit. Once the patch is merged upstream, drop the
patch section and bump the version.

## Accuracy

The extension counts a tarball, whereas tokei normally walks a checkout – and
the walker also decides *which* files to count. Those selection rules (hidden
files, `.gitignore`/`.ignore`/`.tokeignore`, shebang fallback, UTF-16
transcoding, embedded-language summarisation) are reproduced in
`extension/lib/`, and the result is verified to match tokei's own walker exactly
on repositories chosen to exercise each rule:

| Repository           | Code lines | Exercises                        |
| -------------------- | ---------- | -------------------------------- |
| `farshed/glock`      | 741        | baseline                         |
| `XAMPPRocky/tokei`   | 6,252      | `.tokeignore`, hidden dirs       |
| `BurntSushi/ripgrep` | 43,980     | `!/.github/` whitelist, shebangs  |
| `sharkdp/bat`        | 48,608     | UTF-16 files, unknown extensions  |
| `expressjs/express`  | 16,185     | –                                |
| `psf/requests`       | 12,027     | –                                |
| `sindresorhus/got`   | 34,966     | –                                |

## Caching

Counts are cached in the browser for 30 minutes, so the badge may not reflect
new commits right away. Repositories above the configured size limit (50 MB by
default) show no badge, since counting means downloading the whole archive.
