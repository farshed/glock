#!/usr/bin/env bash
# Builds the tokei counting core to wasm and drops it into the extension.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! rustup target list --installed | grep -qx wasm32-unknown-unknown; then
  echo "error: wasm32-unknown-unknown target missing." >&2
  echo "       run: rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi

cargo build --release --target wasm32-unknown-unknown

SRC=target/wasm32-unknown-unknown/release/glock.wasm
DEST=extension/tokei.wasm
cp "$SRC" "$DEST"

if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Oz "$DEST" -o "$DEST.opt" && mv "$DEST.opt" "$DEST"
  echo "optimised with wasm-opt"
fi

printf 'wrote %s (%s, %s gzipped)\n' \
  "$DEST" \
  "$(du -h "$DEST" | cut -f1 | tr -d ' ')" \
  "$(gzip -c "$DEST" | wc -c | awk '{printf "%.1fKB", $1/1024}')"
