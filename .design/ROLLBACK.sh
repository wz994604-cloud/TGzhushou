#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cp "$ROOT/.design/MODIFIED_FILE.baseline-mini-ios-glass.css" "$ROOT/src/mini-ios-glass.css"
printf '%s\n' "Restored src/mini-ios-glass.css from .design/MODIFIED_FILE.baseline-mini-ios-glass.css"
