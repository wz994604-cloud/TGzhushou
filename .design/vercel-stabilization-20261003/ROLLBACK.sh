#!/usr/bin/env bash
set -euo pipefail

target=${1:?usage: ROLLBACK.sh TARGET_DIRECTORY_RELATIVE_TO_REPO}
case "$target" in
  /*|*..*) echo 'target must be a relative directory inside the repository' >&2; exit 2 ;;
esac
artifact_dir=$(cd "$(dirname "$0")" && pwd)
patch=$artifact_dir/DIFF_FILE.patch
cd "$artifact_dir/../.."
test -d "$target"
git apply --reverse --check --directory="$target" "$patch"
git apply --reverse --directory="$target" "$patch"
printf 'ROLLBACK_APPLIED\n'
