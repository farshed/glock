<div align="center">
  <img src="assets/glock_logo_optimized.png" alt="Glock logo" width="200" />
  <h1>Glock</h1>
  <p>GitHub Lines-Of-Code Kounter.</p>
</div>

---

Glock is a chrome extension that displays LOC on GitHub repos. It uses [tokei](https://github.com/XAMPPRocky/tokei) for counting.

Counting runs entirely in the browser: the extension downloads the repository archive from GitHub and counts it with tokei compiled to WebAssembly.

## Layout

| Path         | What it is                                                    |
| ------------ | ------------------------------------------------------------- |
| `extension/` | The Chrome extension. See `extension/README.md`.               |
| `src/`       | Rust shim exposing tokei's counting core to JavaScript.   |
| `scripts/`   | `build-wasm.sh` to build the module, `package.sh` to zip the ext.  |

## Building

```
rustup target add wasm32-unknown-unknown   # once
./scripts/build-wasm.sh                    # writes extension/tokei.wasm
```

## Caching

Counts are cached in the browser for 15 minutes, so the badge may not reflect
new commits right away. Repositories above the configured size limit (50 MB by
default) show no badge, since counting means downloading the whole archive.
