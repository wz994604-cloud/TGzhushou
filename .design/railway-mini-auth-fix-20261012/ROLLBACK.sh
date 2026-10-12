#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${1:?Usage: ROLLBACK.sh TARGET_COPY_DIRECTORY}"
python3 - "$HERE" "$1" <<'RESTORE'
from pathlib import Path
import sys, shutil, hashlib
source=Path(sys.argv[1]); target=Path(sys.argv[2])
for line in (source/'BASELINE.sha256').read_text().splitlines():
    digest,name=line.split('  ',1)
    data=(source/'baseline'/name).read_bytes()
    assert hashlib.sha256(data).hexdigest()==digest
    dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
    assert hashlib.sha256(dest.read_bytes()).hexdigest()==digest
print('RESTORED: 3 files; SHA256 MATCH')
RESTORE
