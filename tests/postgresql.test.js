import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { postgresStatement } from '../server/postgres-sql.js';
import { openDatabase, getSetting, setSetting } from '../server/db.js';
import { sentActions } from '../server/sent-actions.js';

test('PostgreSQL bindings preserve literals, named values and insert IDs', () => {
  assert.deepEqual(postgresStatement("SELECT '?' literal, @q first, @q second", { q: 'hello' }), {
    text: "SELECT '?' literal, $1 first, $2 second", values: ['hello','hello']
  });
  assert.deepEqual(postgresStatement('INSERT OR IGNORE INTO media(sha256) VALUES(?)', ['hash']), {
    text: 'INSERT INTO media(sha256) VALUES($1) ON CONFLICT DO NOTHING RETURNING id', values: ['hash']
  });
});

test('PostgreSQL isolated schema: initialization, IDs, conflict, transactions, aggregates and cleanup triggers',
  { skip: process.env.PG_INTEGRATION !== '1' }, async () => {
    const originalUrl = process.env.DATABASE_URL;
    const admin = new pg.Client({ connectionString: originalUrl });
    const schema = `acceptance_${Date.now()}_${process.pid}`;
    let db;
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(originalUrl);
      url.searchParams.set('options', `-c search_path=${schema}`);
      process.env.DATABASE_URL = url.href;
      db = openDatabase();
      assert.equal(db.prepare('SELECT count(*) n FROM information_schema.tables WHERE table_schema=?').get(schema).n, 19);
      setSetting(db, 'named', 'first');
      setSetting(db, 'named', 'second');
      assert.equal(getSetting(db, 'named'), 'second');
      assert.equal(db.prepare('SELECT value FROM settings WHERE key=@key').get({ key: 'named' }).value, 'second');
      db.transaction(() => setSetting(db, 'committed', 'yes'))();
      assert.throws(() => db.transaction(() => { setSetting(db, 'rolled_back', 'no'); throw new Error('abort'); })(), /abort/);
      assert.equal(getSetting(db, 'rolled_back'), '');
      const now = Date.now();
      const insert = db.prepare('INSERT OR IGNORE INTO media(sha256,mime,size,file_path,created_at) VALUES(?,?,?,?,?)');
      const media = insert.run('test-hash','image/png',3,'test.png',now);
      assert.equal(media.changes, 1);
      assert.ok(Number.isSafeInteger(media.lastInsertRowid));
      assert.equal(insert.run('test-hash','image/png',3,'test.png',now).changes, 0);
      const message = db.prepare(`INSERT INTO chat_messages(bot_id,chat_id,telegram_message_id,direction,text,sent_at)
        VALUES('test','1','1','OUT','hello',?)`).run(now);
      sentActions(db, () => null);
      db.prepare("INSERT INTO sent_changes(kind,delivery_id,updated_at) VALUES('chat',?,?)").run(message.lastInsertRowid,now);
      db.prepare('DELETE FROM chat_messages WHERE id=?').run(message.lastInsertRowid);
      assert.equal(db.prepare('SELECT count(*) n FROM sent_changes').get().n, 0);
      const broadcast = db.prepare(`INSERT INTO broadcasts(name,delta_json,buttons_json,bot_id,status,created_at)
        VALUES('test','[]','[]','test','PENDING',?)`).run(now);
      db.prepare(`INSERT INTO broadcast_deliveries(broadcast_id,telegram_id,status) VALUES(?,'1','SUCCESS'),(?,'2','PENDING')`)
        .run(broadcast.lastInsertRowid,broadcast.lastInsertRowid);
      const row = db.prepare(`SELECT b.*,SUM(CASE WHEN d.status='SUCCESS' THEN 1 ELSE 0 END) success_count
        FROM broadcasts b LEFT JOIN broadcast_deliveries d ON d.broadcast_id=b.id GROUP BY b.id`).get();
      assert.equal(row.success_count, 1);
      await db.close(); db = openDatabase();
      assert.equal(getSetting(db, 'committed'), 'yes');
      assert.equal(getSetting(db, 'rolled_back'), '');
    } finally {
      if (db) await db.close();
      process.env.DATABASE_URL = originalUrl;
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
