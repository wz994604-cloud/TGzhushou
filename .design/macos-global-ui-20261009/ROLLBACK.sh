#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
for file in "$ROOT"/baseline/*; do cp "$file" "$ROOT/rollback-test/$(basename "$file")"; done
printf '%s\n' 'rollback-test restored baseline copies'
