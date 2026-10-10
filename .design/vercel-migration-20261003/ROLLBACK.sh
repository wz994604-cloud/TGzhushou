#!/usr/bin/env bash
set -euo pipefail
git -C "$1" restore --source 30fbeb8 --staged --worktree .
git -C "$1" clean -fd api server/schema.sql server/turso-worker.js vercel.json
