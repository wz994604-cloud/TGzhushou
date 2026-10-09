import { getSetting, setSetting } from './db.js';

export async function initializePlayerImports(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS bot_players(
    bot_id TEXT NOT NULL, telegram_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '', platform_id TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
    first_seen BIGINT NOT NULL, last_seen BIGINT NOT NULL, source TEXT NOT NULL DEFAULT 'ffa',
    PRIMARY KEY(bot_id, telegram_id));
    CREATE INDEX IF NOT EXISTS bot_players_name ON bot_players(bot_id, display_name);`);
  return { version: 2 };
}

export async function playerSourceToken(db, botId) {
  return await getSetting(db, `ffa_token:${botId}`);
}

export async function savePlayerSourceToken(db, botId, encrypted) {
  await setSetting(db, `ffa_token:${botId}`, encrypted);
}

export async function upsertPlayers(db, botId, rows, source, now = Date.now()) {
  if (!botId) throw new Error('请先选择已绑定的发布机器人');
  const upsert = db.prepare(`INSERT INTO bot_players
    (bot_id,telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(bot_id,telegram_id) DO UPDATE SET
    display_name=excluded.display_name,username=CASE WHEN excluded.source='csv' THEN bot_players.username ELSE excluded.username END,
    platform_id=excluded.platform_id,active=excluded.active,last_seen=excluded.last_seen,source=excluded.source`);
  return await db.transaction(async () => {
    const stats = { created: 0, updated: 0 };
    for (const row of rows) {
      const existed = await db.prepare('SELECT 1 FROM bot_players WHERE bot_id=? AND telegram_id=?').get(botId, row.telegramId);
      await upsert.run(botId, row.telegramId, row.displayName, row.username, row.platformId, row.active, now, now, source);
      existed ? stats.updated++ : stats.created++;
    }
    return stats;
  })();
}
