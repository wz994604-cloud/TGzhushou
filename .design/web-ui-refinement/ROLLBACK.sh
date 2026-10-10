#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/bin:/bin:$PATH"
base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target="${1:?Pass the destination source directory explicitly}"
[ -d "$target" ] || { printf 'Destination directory missing\n' >&2; exit 2; }
for name in main.js workbench-shell.js glass-theme-final.css; do
  cp -- "$base/baseline-$name" "$target/$name"
done
printf 'Restored 3 baseline files\n'