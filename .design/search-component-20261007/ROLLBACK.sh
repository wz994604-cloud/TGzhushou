#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cp "$ROOT/baseline/workbench-shell.js" "$ROOT/rollback-test/workbench-shell.js"
cp "$ROOT/baseline/style.css" "$ROOT/rollback-test/style.css"
printf '%s\n' 'rollback-test restored baseline copies'
