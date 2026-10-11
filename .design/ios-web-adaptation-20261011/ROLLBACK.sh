#!/usr/bin/env bash
set -euo pipefail
TARGET=${1:-.}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$TARGET"
git apply --reverse "$SCRIPT_DIR/DIFF_FILE.patch"
printf 'Rollback applied to %s\n' "$TARGET"
