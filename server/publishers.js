import { getSetting, setSetting, encryptToken, decryptToken } from './db.js';

export async function listPublishers(db) {
  return await db.prepare('SELECT id,username FROM publishers ORDER BY created_at,id').all();
}

export async function getPublisher(db, configKey, id) {
  const selected = id || (await getSetting(db, 'publisher_id'));
  if (!selected) return null;
  const row = await db.prepare('SELECT id,username,token FROM publishers WHERE id=?').get(String(selected));
  if (row) return { id: row.id, username: row.username, token: decryptToken(row.token, configKey) };
  // Unit tests and pre-migration databases still use the legacy singleton fields.
  if (String(selected) !== (await getSetting(db, 'publisher_id'))) return null;
  const encrypted = await getSetting(db, 'publisher_token');
  return encrypted ? { id: String(selected), username: (await getSetting(db, 'publisher_username')) || '', token: decryptToken(encrypted, configKey) } : null;
}

export async function savePublisher(db, configKey, identity, token) {
  const id = String(identity.id), username = identity.username || '', encrypted = encryptToken(token, configKey);
  const now = Date.now();
  await db.transaction(async () => {
    await db.prepare(`INSERT INTO publishers(id,username,token,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username,token=excluded.token,updated_at=excluded.updated_at`)
      .run(id, username, encrypted, now, now);
    const originalId = await getSetting(db, 'publisher_id');
    if (!originalId || originalId === id) {
      await setSetting(db, 'publisher_id', id);
      await setSetting(db, 'publisher_username', username);
      await setSetting(db, 'publisher_token', encrypted);
    }
  })();
  return { id, username };
}
