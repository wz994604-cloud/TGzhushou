#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
for file in "$ROOT"/baseline/*; do
  name="$(basename "$file")"
  cp "$file" "$ROOT/rollback-test/$name"
done
printf '%s\n' 'rollback-test restored baseline copies'
