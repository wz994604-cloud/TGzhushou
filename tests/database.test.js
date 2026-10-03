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
  let db = openDatabase({ localFile });
  db.transaction(() => {
    db.prepare("INSERT INTO settings(key,value) VALUES('committed','yes')").run();
  })();
  assert.throws(() => db.transaction(() => {
    db.prepare("INSERT INTO settings(key,value) VALUES('rolled_back','no')").run();
    throw new Error('abort');
  })(), /abort/);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='rolled_back'").get(), undefined);
  await db.close();
  db = openDatabase({ localFile });
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='committed'").get().value, 'yes');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='rolled_back'").get(), undefined);
  await db.close();
});
