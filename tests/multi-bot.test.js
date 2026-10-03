import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, setSetting, encryptToken } from '../server/db.js';
import { createScheduler } from '../server/scheduler.js';
import { savePublisher, getPublisher, listPublishers } from '../server/publishers.js';
import { configKey, publisherToken } from './helpers.js';

test('publishers and recipients persist independently across database reopen', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-multibot-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const localFile = path.join(dir, 'test.db');
  let db = openDatabase({ localFile });
  savePublisher(db, configKey, { id:222222, username:'original' }, publisherToken);
  db.prepare("INSERT INTO bot_players(bot_id,telegram_id,display_name,first_seen,last_seen) VALUES('222222','80001','原用户',1,1)").run();
  await db.close();
  db = openDatabase({ localFile });
  assert.equal(listPublishers(db).length, 1);
  assert.equal(db.prepare("SELECT display_name FROM bot_players WHERE bot_id='222222' AND telegram_id='80001'").get().display_name, '原用户');
  savePublisher(db, configKey, { id:333333, username:'second' }, '333333:LOCAL_TEST_SECOND_TOKEN_123456789');
  assert.equal(getPublisher(db, configKey, '333333').id, '333333');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bot_players WHERE bot_id='333333'").get().n, 0);
  db.prepare("DELETE FROM bot_players WHERE bot_id='222222' AND telegram_id='80001'").run();
  await db.close();
  db = openDatabase({ localFile });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bot_players WHERE bot_id='222222'").get().n, 0);
  assert.equal(listPublishers(db).length, 2);
  assert.equal(getPublisher(db, configKey).id, '222222');
  await db.close();
});

test('scheduler sends each queued record with its own bot token', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-multibot-send-'));
  const db = openDatabase({localFile:path.join(dir,'test.db')});
  t.after(async () => { await db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  savePublisher(db, configKey, { id:222222, username:'first' }, publisherToken);
  savePublisher(db, configKey, { id:333333, username:'second' }, '333333:LOCAL_TEST_SECOND_TOKEN_123456789');
  const calls = [];
  const scheduler = createScheduler(db, { configKey }, {
    botCall: async (token, method) => { if (method === 'sendMessage') calls.push(token); return { message_id:calls.length+1 }; },
    sendPhoto: async () => { throw new Error('unexpected photo'); }
  });
  const payload = { name:'测试', deltaJson:JSON.stringify([{ insert:'你好\n' }]), buttonsJson:'[]', players:[{ telegramId:'80001', displayName:'用户' }] };
  scheduler.queueBroadcast(payload, '222222');
  scheduler.queueBroadcast(payload, '333333');
  await scheduler.tick();
  assert.deepEqual(calls, [publisherToken, '333333:LOCAL_TEST_SECOND_TOKEN_123456789']);
});
