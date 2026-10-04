import {getSetting, setSetting} from './db.js';

const migrationKey = 'player_import_scope_v1';
const tableExists = async (db, name) => {
  try {
    return Boolean(await db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?").get(name));
  } catch {
    return Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  }
};

// Additive, one-time migration. The legacy singleton is evidence for one bot only.
// Never overwrite existing scoped rows, assign an unknown list, or remove legacy data.
export async function initializePlayerImports(db) {
  return await db.transaction(async () => {
    await db.exec(`CREATE TABLE IF NOT EXISTS bot_players(
      bot_id TEXT NOT NULL, telegram_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '', platform_id TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'ffa',
      PRIMARY KEY(bot_id, telegram_id));
      CREATE INDEX IF NOT EXISTS bot_players_name ON bot_players(bot_id, display_name);`);
    const saved = await getSetting(db, migrationKey);
    if (saved) return JSON.parse(saved);
    const id = await getSetting(db, 'publisher_id');
    const known = /^\d+$/.test(id) && ((await getSetting(db, 'publisher_token')) ||
      (await tableExists(db, 'publishers')) && (await db.prepare('SELECT 1 FROM publishers WHERE id=?').get(id)));
    const legacyBotId = known ? id : '';
    let migrated = 0;
    if (legacyBotId && (await tableExists(db, 'players'))) {
      migrated = (await db.prepare(`INSERT OR IGNORE INTO bot_players
        (bot_id,telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source)
        SELECT ?,telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source FROM players`).run(legacyBotId)).changes;
    }
    const result = {version:1, legacyBotId, migrated};
    await setSetting(db, migrationKey, JSON.stringify(result));
    return result;
  })();
}

export async function legacyPlayerBotId(db) {
  return JSON.parse((await getSetting(db, migrationKey)) || '{}').legacyBotId || '';
}
export async function playerSourceToken(db, botId) {
  return (await getSetting(db, `ffa_token:${botId}`)) ||
    (botId === (await legacyPlayerBotId(db)) ? await getSetting(db, 'ffa_token') : '');
}
export async function savePlayerSourceToken(db, botId, encrypted) {
  await db.transaction(async () => {
    await setSetting(db, `ffa_token:${botId}`, encrypted);
    if (botId === (await legacyPlayerBotId(db))) await setSetting(db, 'ffa_token', encrypted);
  })();
}

export async function upsertPlayers(db, botId, rows, source, now = Date.now()) {
  if (!botId) throw new Error('请先选择已绑定的发布机器人');
  const upsert = db.prepare(`INSERT INTO bot_players
    (bot_id,telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(bot_id,telegram_id) DO UPDATE SET
    display_name=excluded.display_name,username=CASE WHEN excluded.source='csv' THEN bot_players.username ELSE excluded.username END,
    platform_id=excluded.platform_id,active=excluded.active,last_seen=excluded.last_seen,source=excluded.source`);
  // Retain the original bot's legacy mirror for code rollback; other bots never write it.
  const legacy = botId === (await legacyPlayerBotId(db)) && (await tableExists(db, 'players')) ? db.prepare(`INSERT INTO players
    (telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET
    display_name=excluded.display_name,username=CASE WHEN excluded.source='csv' THEN players.username ELSE excluded.username END,
    platform_id=excluded.platform_id,active=excluded.active,last_seen=excluded.last_seen,source=excluded.source`) : null;
  return await db.transaction(async () => {
    const stats = {created:0, updated:0};
    for (const row of rows) {
      const existed = await db.prepare('SELECT 1 FROM bot_players WHERE bot_id=? AND telegram_id=?').get(botId, row.telegramId);
      const args = [row.telegramId,row.displayName,row.username,row.platformId,row.active,now,now,source];
      await upsert.run(botId, ...args);
      if (legacy) legacy.run(...args);
      existed ? stats.updated++ : stats.created++;
    }
    return stats;
  })();
}
