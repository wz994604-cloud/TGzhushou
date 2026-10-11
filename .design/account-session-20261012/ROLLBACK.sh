#!/usr/bin/env bash
set -euo pipefail
TARGET_DIR=${1:?usage: ROLLBACK.sh TARGET_DIR [SOURCE_REPO]}
SOURCE_REPO=${2:-$(pwd)}
for file in package.json src/main.js; do
  git -C "$SOURCE_REPO" show HEAD:"$file" > "$TARGET_DIR/$file"
done
rm -f "$TARGET_DIR/src/auth-session.js" "$TARGET_DIR/tests/auth-session.test.js"
