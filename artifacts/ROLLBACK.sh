#!/usr/bin/env bash
set -eu
destination="${1:-artifacts/rollback-copy}"
mkdir -p "$destination"
if [ -f artifacts/evidence/auth.baseline.js ]; then
  cp artifacts/evidence/auth.baseline.js "$destination/server-auth.baseline.js"
else
  cp server/auth.js "$destination/server-auth.baseline.js"
fi
cp "$destination/server-auth.baseline.js" "$destination/server-auth.js"
cmp -s "$destination/server-auth.baseline.js" "$destination/server-auth.js"
printf 'ROLLBACK_OK restored=%s/server-auth.js\n' "$destination"
