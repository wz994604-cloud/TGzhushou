import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  const db = new Database(path.join(dataDir, 'tgzhushou.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS publishers(
      id TEXT PRIMARY KEY, username TEXT NOT NULL, token TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS targets(
      id INTEGER PRIMARY KEY, bot_id TEXT NOT NULL, chat_id TEXT NOT NULL,
      title TEXT NOT NULL, chat_type TEXT NOT NULL, username TEXT,
      can_publish INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      UNIQUE(bot_id, chat_id)
    );
    CREATE TABLE IF NOT EXISTS media(
      id INTEGER PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, mime TEXT NOT NULL,
      size INTEGER NOT NULL, file_path TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks(
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, delta_json TEXT NOT NULL,
      buttons_json TEXT NOT NULL, target_ids_json TEXT NOT NULL,
      schedule_json TEXT NOT NULL, media_id INTEGER REFERENCES media(id),
      bot_id TEXT NOT NULL, status TEXT NOT NULL, next_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_due ON tasks(status, next_at);
    CREATE TABLE IF NOT EXISTS runs(
      id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id),
      run_key TEXT NOT NULL UNIQUE, source TEXT NOT NULL, slot_at INTEGER NOT NULL,
      status TEXT NOT NULL, bot_id TEXT NOT NULL, delta_json TEXT NOT NULL,
      buttons_json TEXT NOT NULL, media_id INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deliveries(
      id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES runs(id),
      target_id INTEGER NOT NULL, chat_id TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL, telegram_message_id TEXT, error_text TEXT,
      started_at INTEGER, completed_at INTEGER,
      UNIQUE(run_id, target_id)
    );
    CREATE INDEX IF NOT EXISTS delivery_pending ON deliveries(status, id);
    CREATE TABLE IF NOT EXISTS sticker_packs(
      id INTEGER PRIMARY KEY, bot_id TEXT NOT NULL, name TEXT NOT NULL,
      title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(bot_id, name)
    );
    CREATE TABLE IF NOT EXISTS sticker_pack_items(
      id INTEGER PRIMARY KEY, pack_id INTEGER NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
      emoji_id TEXT NOT NULL, alt TEXT NOT NULL, thumbnail_id TEXT, position INTEGER NOT NULL,
      UNIQUE(pack_id, emoji_id)
    );
    CREATE TABLE IF NOT EXISTS players(
      id INTEGER PRIMARY KEY, telegram_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '', platform_id TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'ffa'
    );
    CREATE INDEX IF NOT EXISTS players_name ON players(display_name);
    CREATE TABLE IF NOT EXISTS bot_players(
      bot_id TEXT NOT NULL, telegram_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '', platform_id TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'ffa',
      PRIMARY KEY(bot_id, telegram_id)
    );
    CREATE INDEX IF NOT EXISTS bot_players_name ON bot_players(bot_id, display_name);
    CREATE TABLE IF NOT EXISTS broadcasts(
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, delta_json TEXT NOT NULL, buttons_json TEXT NOT NULL,
      media_id INTEGER REFERENCES media(id), bot_id TEXT NOT NULL, status TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS broadcast_deliveries(
      id INTEGER PRIMARY KEY, broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
      telegram_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      telegram_message_id TEXT, error_text TEXT, started_at INTEGER, completed_at INTEGER,
      UNIQUE(broadcast_id, telegram_id)
    );
    CREATE INDEX IF NOT EXISTS broadcast_pending ON broadcast_deliveries(status, id);
    CREATE TABLE IF NOT EXISTS conversations(
      bot_id TEXT NOT NULL, chat_id TEXT NOT NULL, chat_type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '',
      last_message_id TEXT, last_message_text TEXT NOT NULL DEFAULT '',
      last_message_at INTEGER NOT NULL DEFAULT 0, unread_count INTEGER NOT NULL DEFAULT 0,
      last_read_message_id TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY(bot_id, chat_id)
    );
    CREATE INDEX IF NOT EXISTS conversations_recent ON conversations(bot_id,last_message_at DESC,chat_id);
    CREATE TABLE IF NOT EXISTS chat_messages(
      id INTEGER PRIMARY KEY, bot_id TEXT NOT NULL, chat_id TEXT NOT NULL,
      telegram_message_id TEXT NOT NULL, direction TEXT NOT NULL,
      from_id TEXT, text TEXT NOT NULL DEFAULT '', entities_json TEXT NOT NULL DEFAULT '[]',
      media_kind TEXT, file_id TEXT, media_id INTEGER REFERENCES media(id),
      reply_to_message_id TEXT, sent_at INTEGER NOT NULL, edited_at INTEGER,
      status TEXT NOT NULL DEFAULT 'SUCCESS', buttons_json TEXT NOT NULL DEFAULT '[]',
      UNIQUE(bot_id,chat_id,telegram_message_id)
    );
    CREATE INDEX IF NOT EXISTS chat_messages_page ON chat_messages(bot_id,chat_id,id DESC);
    CREATE INDEX IF NOT EXISTS chat_messages_changes ON chat_messages(bot_id,id);
    CREATE TABLE IF NOT EXISTS chat_events(
      id INTEGER PRIMARY KEY, bot_id TEXT NOT NULL, chat_id TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_events_bot ON chat_events(bot_id,id);
    CREATE TABLE IF NOT EXISTS publisher_inbox(
      bot_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
      webhook_status TEXT NOT NULL DEFAULT 'NOT_CHECKED',
      secret TEXT, last_error TEXT, checked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS browser_links(
      token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS browser_sessions(
      session_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
  `);
  // Keep the original settings and players intact so a rollback can still read them.
  const legacyId = db.prepare("SELECT value FROM settings WHERE key='publisher_id'").get()?.value;
  const legacyToken = db.prepare("SELECT value FROM settings WHERE key='publisher_token'").get()?.value;
  if (legacyId && legacyToken) db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO publishers(id,username,token,created_at,updated_at)
      VALUES(?,?,?,?,?)`).run(legacyId, db.prepare("SELECT value FROM settings WHERE key='publisher_username'").get()?.value || '', legacyToken, Date.now(), Date.now());
    if (!db.prepare("SELECT 1 FROM settings WHERE key='multibot_players_migrated'").get()) {
      db.prepare(`INSERT OR IGNORE INTO bot_players(bot_id,telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source)
        SELECT ?,telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source FROM players`).run(legacyId);
      db.prepare("INSERT INTO settings(key,value) VALUES('multibot_players_migrated','1')").run();
    }
  })();
  return db;
}

function encryptionKey(raw) {
  const key = Buffer.from(String(raw || ''), 'base64');
  if (key.length !== 32) throw new Error('CONFIG_KEY 必须是 32 字节的 Base64 密钥');
  return key;
}

export function encryptToken(token, rawKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(rawKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

export function decryptToken(value, rawKey) {
  const [iv, tag, ciphertext] = String(value || '').split('.').map(part => Buffer.from(part, 'base64url'));
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !ciphertext) throw new Error('发布机器人 Token 配置损坏');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(rawKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export const getSetting = (db, key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '';
export const setSetting = (db, key, value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
