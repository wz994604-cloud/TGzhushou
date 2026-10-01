import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, setSetting, encryptToken } from '../server/db.js';
import { createScheduler } from '../server/scheduler.js';
import { configKey, publisherToken } from './helpers.js';

test('broadcast queues selected players, sends privately and records per-player results', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-broadcast-'));
  const db = openDatabase(dir); t.after(() => { db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  setSetting(db, 'publisher_token', encryptToken(publisherToken, configKey)); setSetting(db, 'publisher_id', '222222');
  const now = Date.now();
  db.prepare("INSERT INTO players(telegram_id,display_name,first_seen,last_seen) VALUES('8547433574','涵涵',?,?)").run(now, now);
  db.prepare("INSERT INTO players(telegram_id,display_name,first_seen,last_seen) VALUES('9876543210','李四',?,?)").run(now, now);
  const calls = [];
  const api = { botCall: async (_token, method, payload) => { calls.push({ method, payload }); return { message_id: calls.length, entities: payload.entities || [] }; }, sendPhoto: async () => ({ message_id: 99 }) };
  const scheduler = createScheduler(db, { configKey }, api);
  const id = scheduler.queueBroadcast({ name:'测试私信', deltaJson:JSON.stringify([{ insert:'你好\n' }]), buttonsJson:'[]', players:[{telegramId:'8547433574',displayName:'涵涵'},{telegramId:'9876543210',displayName:'李四'}] });
  await scheduler.tick();
  assert.equal(db.prepare('SELECT total_count FROM broadcasts WHERE id=?').get(id).total_count, 2);
  assert.deepEqual(calls.map(call => call.payload.chat_id), ['8547433574','9876543210']);
  assert.deepEqual(db.prepare('SELECT status FROM broadcast_deliveries ORDER BY id').all().map(row => row.status), ['SUCCESS','SUCCESS']);
  assert.equal(db.prepare('SELECT status FROM broadcasts WHERE id=?').get(id).status, 'COMPLETED');
});
