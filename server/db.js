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
  `);
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
