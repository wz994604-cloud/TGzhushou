import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.js';

test('database transaction commits, rolls back on failure and persists after reopen', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-db-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const localFile = path.join(dir, 'test.db');
  let db = await openDatabase({ localFile });
  await db.transaction(async () => {
    await db.prepare("INSERT INTO settings(key,value) VALUES('committed','yes')").run();
  })();
  await assert.rejects(async () => await db.transaction(async () => {
    await db.prepare("INSERT INTO settings(key,value) VALUES('rolled_back','no')").run();
    throw new Error('abort');
  })(), /abort/);
  assert.equal(await db.prepare("SELECT value FROM settings WHERE key='rolled_back'").get(), undefined);
  await db.close();
  db = await openDatabase({ localFile });
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key='committed'").get()).value, 'yes');
  assert.equal(await db.prepare("SELECT value FROM settings WHERE key='rolled_back'").get(), undefined);
  await db.close();
});

test('database prepared statements accept named bindings', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-named-db-'));
  const db = await openDatabase({ localFile: path.join(dir, 'test.db') });
  t.after(async () => {
    await db.close();
    fs.rmSync(dir, { recursive:true, force:true });
  });
  assert.equal((await db.prepare('INSERT INTO settings(key,value) VALUES(@key,@value)')
    .run({ key: 'named', value: 'yes' })).changes, 1);
  assert.equal((await db.prepare('SELECT value FROM settings WHERE key=@key')
    .get({ key: 'named' })).value, 'yes');
  assert.deepEqual((await db.prepare('SELECT value FROM settings WHERE key=@key')
    .all({ key: 'named' })).map(row => row.value), ['yes']);
});
