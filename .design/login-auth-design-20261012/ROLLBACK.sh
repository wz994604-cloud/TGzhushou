#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${1:?Usage: ROLLBACK.sh TARGET_COPY_DIRECTORY}"
python3 - "$SCRIPT_DIR" "$1" <<'RESTORE'
from pathlib import Path
import shutil, sys, hashlib
source=Path(sys.argv[1]); target=Path(sys.argv[2]).resolve()
for line in (source/'BASELINE.sha256').read_text().splitlines():
    expected, name=line.split('  ',1)
    original=source/'baseline'/name
    assert hashlib.sha256(original.read_bytes()).hexdigest()==expected,name
    dest=target/name; dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(original,dest)
    assert hashlib.sha256(dest.read_bytes()).hexdigest()==expected,name
print('RESTORED: 4 files; SHA256 MATCH')
RESTORE
