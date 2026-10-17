import { encryptToken, decryptToken } from './db.js';

export async function listPublishers(db) {
  return await db.prepare(`SELECT p.id,p.username,COALESCE(l.status,'ACTIVE') AS status FROM publishers p
    LEFT JOIN publisher_lifecycle l ON l.bot_id=p.id WHERE COALESCE(l.status,'ACTIVE')!='REMOVED' ORDER BY p.created_at,p.id`).all();
}

export async function getPublisher(db, configKey, id, { includeInactive = false } = {}) {
  if (!id) return null;
  const row = await db.prepare(`SELECT p.id,p.username,p.token,COALESCE(l.status,'ACTIVE') AS status FROM publishers p
    LEFT JOIN publisher_lifecycle l ON l.bot_id=p.id WHERE p.id=?`).get(String(id));
  return row && row.status !== 'REMOVED' && (includeInactive || row.status === 'ACTIVE')
    ? { ...row, token: decryptToken(row.token, configKey) } : null;
}

export async function isPublisherActive(db, id) {
  const row = await db.prepare(`SELECT p.id,COALESCE(l.status,'ACTIVE') AS status FROM publishers p
    LEFT JOIN publisher_lifecycle l ON l.bot_id=p.id WHERE p.id=?`).get(String(id));
  return row?.status === 'ACTIVE';
}

export async function savePublisher(db, configKey, identity, token) {
  const id = String(identity.id), username = identity.username || '', encrypted = encryptToken(token, configKey);
  const now = Date.now();
  await db.transaction(async () => {
    await db.prepare(`INSERT INTO publishers(id,username,token,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username,token=excluded.token,updated_at=excluded.updated_at`)
      .run(id, username, encrypted, now, now);
    // Only an explicit rebind restores a removed bot. Disabled bots stay disabled.
    await db.prepare(`INSERT INTO publisher_lifecycle(bot_id,status,updated_at) VALUES(?,'ACTIVE',?)
      ON CONFLICT(bot_id) DO UPDATE SET status=CASE WHEN publisher_lifecycle.status='REMOVED' THEN 'ACTIVE' ELSE publisher_lifecycle.status END,updated_at=excluded.updated_at`).run(id, now);
  })();
  return { id, username };
}

export async function updatePublisherToken(db, configKey, id, identity, token) {
  if (String(identity.id) !== String(id)) throw new Error('新 Token 的机器人身份不同，请单独添加机器人');
  if (!await getPublisher(db, configKey, id, { includeInactive:true })) throw new Error('机器人不存在');
  return savePublisher(db, configKey, identity, token);
}

export async function setPublisherStatus(db, id, status) {
  if (!['ACTIVE','DISABLED','REMOVED'].includes(status)) throw new Error('机器人状态无效');
  return db.transaction(async () => {
    const row = await db.prepare('SELECT id FROM publishers WHERE id=?').get(String(id));
    if (!row) throw new Error('机器人不存在');
    const old = await db.prepare('SELECT status FROM publisher_lifecycle WHERE bot_id=?').get(String(id));
    if (old?.status === 'REMOVED') throw new Error('机器人已移除，请重新绑定');
    const now = Date.now();
    await db.prepare(`INSERT INTO publisher_lifecycle(bot_id,status,updated_at) VALUES(?,?,?)
      ON CONFLICT(bot_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`).run(String(id),status,now);
    if (status !== 'ACTIVE') {
      const reason = status === 'REMOVED' ? '机器人已从工作台移除' : '机器人已停用';
      await db.prepare("UPDATE tasks SET status='PAUSED',next_at=NULL,updated_at=? WHERE bot_id=? AND status IN ('ACTIVE','DRAFT')").run(now,String(id));
      await db.prepare(`UPDATE deliveries SET status='CANCELLED',error_text=?,completed_at=? WHERE status='PENDING' AND run_id IN (SELECT id FROM runs WHERE bot_id=?)`).run(reason,now,String(id));
      await db.prepare(`UPDATE broadcast_deliveries SET status='CANCELLED',error_text=?,completed_at=? WHERE status='PENDING' AND broadcast_id IN (SELECT id FROM broadcasts WHERE bot_id=?)`).run(reason,now,String(id));
      await db.prepare("UPDATE publisher_inbox SET enabled=0,secret=NULL,webhook_status='DISABLED',last_error=? WHERE bot_id=?").run(reason,String(id));
    }
    return { id:String(id), status };
  })();
}
