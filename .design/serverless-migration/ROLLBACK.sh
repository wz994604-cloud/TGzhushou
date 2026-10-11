#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-.design/serverless-migration/rollback-test/package.json}"
BASELINE="${2:-.design/serverless-migration/MODIFIED_FILE.baseline}"
mkdir -p "$(dirname "$TARGET")"
cp "$BASELINE" "$TARGET"
printf 'ROLLBACK_OK restored=%s hash=%s\n' "$TARGET" "$(shasum -a 256 "$TARGET" | awk '{print $1}')"
