import { getSetting, setSetting, encryptToken, decryptToken } from './db.js';

export function listPublishers(db) {
  return db.prepare('SELECT id,username FROM publishers ORDER BY created_at,id').all();
}

export function getPublisher(db, configKey, id) {
  const selected = id || getSetting(db, 'publisher_id');
  if (!selected) return null;
  const row = db.prepare('SELECT id,username,token FROM publishers WHERE id=?').get(String(selected));
  if (row) return { id: row.id, username: row.username, token: decryptToken(row.token, configKey) };
  // Unit tests and pre-migration databases still use the legacy singleton fields.
  if (String(selected) !== getSetting(db, 'publisher_id')) return null;
  const encrypted = getSetting(db, 'publisher_token');
  return encrypted ? { id: String(selected), username: getSetting(db, 'publisher_username') || '', token: decryptToken(encrypted, configKey) } : null;
}

export function savePublisher(db, configKey, identity, token) {
  const id = String(identity.id), username = identity.username || '', encrypted = encryptToken(token, configKey);
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`INSERT INTO publishers(id,username,token,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username,token=excluded.token,updated_at=excluded.updated_at`)
      .run(id, username, encrypted, now, now);
    const originalId = getSetting(db, 'publisher_id');
    if (!originalId || originalId === id) {
      setSetting(db, 'publisher_id', id);
      setSetting(db, 'publisher_username', username);
      setSetting(db, 'publisher_token', encrypted);
    }
  })();
  return { id, username };
}
