#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-.design/serverless-admin-init/rollback-test/auth.js}"
BASELINE="${2:-.design/serverless-admin-init/BASELINE_FILE.js}"
cp "$BASELINE" "$TARGET"
shasum -a 256 "$TARGET"
