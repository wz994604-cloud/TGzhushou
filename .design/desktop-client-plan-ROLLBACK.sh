#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
rm -f "$ROOT/DESKTOP_CLIENT_PLAN.md" "$ROOT/desktop-client-plan-diff.patch" "$ROOT/desktop-client-plan-VERIFICATION.txt"
printf '%s\n' "Removed desktop client planning artifacts. Source code was not modified."
