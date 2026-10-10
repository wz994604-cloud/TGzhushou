#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/bin:/bin:$PATH"
TARGET="${1:?pass a CSS copy path}"
BASELINE="$(cd "$(dirname "$0")" && pwd)/BASELINE.css"
cp "$BASELINE" "$TARGET"
cmp -s "$BASELINE" "$TARGET"
printf 'restored baseline: %s\n' "$TARGET"
