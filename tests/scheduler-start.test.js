import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.js';
import { createScheduler } from '../server/scheduler.js';

test('scheduler start keeps ticking once and stop clears the timer', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-scheduler-'));
  const db = openDatabase({ localFile:path.join(dir, 'test.db') });
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let intervalCalls = 0, cleared = null, unrefCalls = 0;
  const fakeTimer = { unref() { unrefCalls++; } };

  globalThis.setInterval = (fn, delay) => {
    intervalCalls++;
    assert.equal(typeof fn, 'function');
    assert.equal(delay, 15_000);
    return fakeTimer;
  };
  globalThis.clearInterval = timer => { cleared = timer; };
  t.after(async () => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    await db.close();
    fs.rmSync(dir, { recursive:true, force:true });
  });

  const scheduler = createScheduler(db, { configKey:'unused-in-this-test' });
  scheduler.start();
  scheduler.start();
  assert.equal(intervalCalls, 1);
  assert.equal(unrefCalls, 1);
  scheduler.stop();
  assert.equal(cleared, fakeTimer);
});
