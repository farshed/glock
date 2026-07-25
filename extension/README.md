# Glock

A Chrome (MV3) extension that adds a lines-of-code badge next to the repository
name on every GitHub repo page. Counting happens entirely in the browser — there
is no server.

```
BurntSushi / ripgrep  [ 43,980 LOC ]
```

## How it works

1. A content script (`content.js`) detects repo pages, finds the repo-name
   element, and asks the background service worker for a count via
   `chrome.runtime.sendMessage`.
2. The worker (`background.js`) reads the repo's metadata from the GitHub API to
   get its size and default branch, and gives up early if it is over the size
   limit.
3. It downloads the repository tarball from `codeload.github.com`, unzips it
   with `DecompressionStream`, and walks the archive (`lib/tar.js`).
4. Each file is counted by [tokei](https://github.com/XAMPPRocky/tokei) compiled
   to WebAssembly (`tokei.wasm`), and the result is cached in
   `chrome.storage.local`.

Nothing about the repository, and in particular no access token, is sent
anywhere except GitHub.

### Matching tokei's numbers

Counting a tarball is not quite the same as counting a checkout, because the
directory walker tokei normally uses also decides *which* files to count. The
extension reproduces those rules in `lib/ignore.js` and `lib/counter.js`:

- **Hidden files are skipped** — unless an ignore rule explicitly re-includes
  them. ripgrep ships an `.ignore` containing `!/.github/` for exactly this.
- **`.gitignore`, `.ignore`, and `.tokeignore` are honoured**, including
  negation, anchoring, and per-directory precedence.
- **Extensionless files fall back to shebang detection**, so `ci/build` is
  counted as a shell script. A file with an *unrecognised* extension does not —
  matching tokei, which only consults the shebang when there is no extension.
- **BOM-prefixed and UTF-16 files are transcoded** before counting, the same way
  tokei does when it reads a file itself.
- **Embedded languages are summarised** — fenced code blocks in Markdown and
  `<script>`/`<style>` in HTML count toward the total.

These are verified against the native tokei walker; see the repo root README.

## Setup

1. Build the wasm module (once, and after any change under `wasm/`):
   ```
   ./scripts/build-wasm.sh      # from the repo root
   ```
2. Load the extension:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select this `extension/` folder
3. Visit any repo, e.g. `https://github.com/BurntSushi/ripgrep`.

The first view of a repo downloads its archive, so the badge takes a moment to
appear. Subsequent views are served from cache (30 minutes).

## Options

Click the extension's toolbar icon (or use **Extension options**) to set:

- **Personal Access Token** — a fine-grained token with `Contents: Read-only`,
  needed only for private repositories. Stored locally in this browser and sent
  only to GitHub. It also raises the API rate limit from 60 to 5,000 requests
  per hour.
- **Maximum repository size** — repositories larger than this show no badge,
  since counting downloads the whole archive. Defaults to 10 MB, up to 100 MB.
