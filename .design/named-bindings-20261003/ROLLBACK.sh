#!/bin/sh
set -eu
target=${1:?usage: ROLLBACK.sh TARGET_DIRECTORY}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
git -C "$target" apply --reverse "$script_dir/DIFF_FILE"
node -e 'const fs = require("node:fs"); for (const name of ["server/db.js", "tests/database.test.js"]) { const file = require("node:path").join(process.argv[1], name); fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")); }' "$target"
