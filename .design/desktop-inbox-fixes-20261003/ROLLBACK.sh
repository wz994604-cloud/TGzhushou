#!/bin/sh
set -eu
target=${1:?usage: ROLLBACK.sh TARGET_DIRECTORY}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
git -C "$target" apply --reverse "$script_dir/DIFF_FILE"
node -e 'const fs = require("node:fs"), path = require("node:path"); for (const name of ["server/chat.js", "src/main.js", "src/style.css", "tests/chat.test.js"]) { const file = path.join(process.argv[1], name); fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")); }' "$target"
