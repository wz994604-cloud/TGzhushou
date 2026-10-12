#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${1:?Usage: ROLLBACK.sh TARGET_COPY_DIRECTORY}"
python3 - "$HERE" "$1" <<'RESTORE'
from pathlib import Path
import sys, hashlib
source=Path(sys.argv[1]);target=Path(sys.argv[2]).resolve()
rows=[line.split('  ',1) for line in (source/'BASELINE.sha256').read_text().splitlines()]
added=[line.split('  ',1) for line in (source/'ADDED.sha256').read_text().splitlines()]
for digest,name in rows:
    assert hashlib.sha256((source/'baseline'/name).read_bytes()).hexdigest()==digest,name
for digest,name in added:
    path=target/name
    assert not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()==digest, f'New file changed; preserve it before rollback: {name}'
for digest,name in rows:
    dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_bytes((source/'baseline'/name).read_bytes())
    assert hashlib.sha256(dest.read_bytes()).hexdigest()==digest,name
for _,name in added:
    (target/name).unlink(missing_ok=True)
print(f'RESTORED: {len(rows)} original files; {len(added)} task-added files removed; SHA256 MATCH')
RESTORE
