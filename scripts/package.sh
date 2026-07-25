#!/usr/bin/env bash
# Builds the wasm module and zips the extension into dist/ for the Web Store.
set -euo pipefail

cd "$(dirname "$0")/.."

./scripts/build-wasm.sh

VERSION=$(grep '"version"' extension/manifest.json | head -1 | cut -d'"' -f4)
OUT="dist/glock-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

# Contents sit at the archive root, not under extension/.
(cd extension && zip -rq "../$OUT" . \
  -x "README.md" ".DS_Store" "*/.DS_Store" "*.map")

printf 'wrote %s (%s)\n' "$OUT" "$(du -h "$OUT" | cut -f1 | tr -d ' ')"
unzip -Z1 "$OUT" | sed 's/^/  /'
