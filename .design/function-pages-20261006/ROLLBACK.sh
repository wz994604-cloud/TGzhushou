#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:?pass a CSS copy path}"
BASELINE="$(dirname "$0")/BASELINE.css"
cp "$BASELINE" "$TARGET"
cmp -s "$BASELINE" "$TARGET"
printf 'restored baseline: %s\n' "$TARGET"
