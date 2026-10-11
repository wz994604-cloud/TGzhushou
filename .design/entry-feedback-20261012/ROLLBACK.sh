#!/usr/bin/env bash
set -euo pipefail
TARGET=${1:-.}
PATCH_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$TARGET"
git apply --reverse "$PATCH_DIR/DIFF_FILE.patch"
printf 'Rollback applied to %s\n' "$TARGET"
