# Serverless migration surface

`tgcloud/` is the new Telegram Serverless boundary. The old `server/` Express/PostgreSQL implementation remains the rollback baseline during migration.

- `handlers/`: Telegram update handlers
- `endpoints/`: Mini App API endpoints
- `lib/`: shared Serverless modules
- `schema.js`: new per-bot SQLite schema; no old data is imported
