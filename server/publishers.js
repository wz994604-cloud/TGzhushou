import { encryptToken, decryptToken } from './db.js';

export async function listPublishers(db) {
  return await db.prepare('SELECT id,username FROM publishers ORDER BY created_at,id').all();
}

export async function getPublisher(db, configKey, id) {
  const selected = id;
  if (!selected) return null;
  const row = await db.prepare('SELECT id,username,token FROM publishers WHERE id=?').get(String(selected));
  return row ? { id: row.id, username: row.username, token: decryptToken(row.token, configKey) } : null;
}

export async function savePublisher(db, configKey, identity, token) {
  const id = String(identity.id), username = identity.username || '', encrypted = encryptToken(token, configKey);
  const now = Date.now();
  await db.transaction(async () => {
    await db.prepare(`INSERT INTO publishers(id,username,token,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username,token=excluded.token,updated_at=excluded.updated_at`)
      .run(id, username, encrypted, now, now);
  })();
  return { id, username };
}
