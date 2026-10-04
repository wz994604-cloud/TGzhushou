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
  const db = await openDatabase({localFile:path.join(dir,'test.db')}); t.after(async () => { await db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  await setSetting(db, 'publisher_token', encryptToken(publisherToken, configKey)); await setSetting(db, 'publisher_id', '222222');
  const now = Date.now();
  await db.prepare("INSERT INTO players(telegram_id,display_name,first_seen,last_seen) VALUES('8547433574','涵涵',?,?)").run(now, now);
  await db.prepare("INSERT INTO players(telegram_id,display_name,first_seen,last_seen) VALUES('9876543210','李四',?,?)").run(now, now);
  const calls = [];
  const api = { botCall: async (_token, method, payload) => { calls.push({ method, payload }); return { message_id: calls.length, entities: payload.entities || [] }; }, sendPhoto: async () => ({ message_id: 99 }) };
  const scheduler = createScheduler(db, { configKey }, api);
  const id = await scheduler.queueBroadcast({ name:'测试私信', deltaJson:JSON.stringify([{ insert:'你好\n' }]), buttonsJson:'[]', players:[{telegramId:'8547433574',displayName:'涵涵'},{telegramId:'9876543210',displayName:'李四'}] });
  await scheduler.tick();
  assert.equal((await db.prepare('SELECT total_count FROM broadcasts WHERE id=?').get(id)).total_count, 2);
  assert.deepEqual(calls.map(call => call.payload.chat_id), ['8547433574','9876543210']);
  assert.deepEqual((await db.prepare('SELECT status FROM broadcast_deliveries ORDER BY id').all()).map(row => row.status), ['SUCCESS','SUCCESS']);
  assert.equal((await db.prepare('SELECT status FROM broadcasts WHERE id=?').get(id)).status, 'COMPLETED');
});

test('cron ticks drain a broadcast in bounded batches', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-batches-'));
  const db = await openDatabase({localFile:path.join(dir,'test.db')});
  t.after(async () => { await db.close(); fs.rmSync(dir, {recursive:true,force:true}); });
  await setSetting(db, 'publisher_token', encryptToken(publisherToken, configKey));
  await setSetting(db, 'publisher_id', '222222');
  const calls = [];
  const scheduler = createScheduler(db, { configKey }, {
    botCall: async (_token, method, payload) => { if (method === 'sendMessage') calls.push(payload.chat_id); return {message_id:calls.length}; },
    sendPhoto: async () => { throw new Error('unexpected media'); }
  });
  const players = Array.from({length:6}, (_, index) => ({telegramId:String(80001+index), displayName:'用户'}));
  await scheduler.queueBroadcast({name:'批量测试',deltaJson:JSON.stringify([{insert:'你好\n'}]),buttonsJson:'[]',players});
  for (const expected of [2,4,6]) {
    await scheduler.tick({maxDeliveries:2});
    assert.equal(calls.length, expected);
  }
  assert.equal((await db.prepare("SELECT status FROM broadcasts").get()).status, 'COMPLETED');
});

test('200 broadcast recipients queue atomically across SQL chunks', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-200-'));
  const db = await openDatabase({localFile:path.join(dir,'test.db')});
  t.after(async () => { await db.close(); fs.rmSync(dir, {recursive:true,force:true}); });
  await setSetting(db, 'publisher_token', encryptToken(publisherToken, configKey));
  await setSetting(db, 'publisher_id', '222222');
  const scheduler = createScheduler(db, {configKey});
  const players = Array.from({length:200}, (_, index) => ({telegramId:String(900000+index),displayName:'用户'}));
  const id = await scheduler.queueBroadcast({name:'200人测试',deltaJson:JSON.stringify([{insert:'你好\n'}]),buttonsJson:'[]',players});
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM broadcast_deliveries WHERE broadcast_id=?').get(id)).count, 200);
});
