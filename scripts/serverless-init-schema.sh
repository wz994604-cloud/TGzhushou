#!/usr/bin/env bash
set -euo pipefail

# Run interactively after `pnpm exec tgcloud login`.
# This applies the new schema only; it never imports or deletes PostgreSQL data.
pnpm exec tgcloud push tgcloud/schema.js
pnpm exec tgcloud migrate
