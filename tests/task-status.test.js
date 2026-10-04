import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { openDatabase } from '../server/db.js';
import { nextSlot } from '../server/schedule.js';

test('stop cancels both queues, preserves in-flight delivery and restart never revives cancelled messages', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-stop-'));
  const db = await openDatabase({localFile:path.join(dir,'test.db')});
  t.after(async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await db.prepare(`INSERT INTO tasks(id,name,delta_json,buttons_json,target_ids_json,schedule_json,bot_id,status,created_at,updated_at)
    VALUES(1,'fixture','[]','[]','[]','{"kind":"MANUAL"}','222222','DRAFT',0,0)`).run();
  for (const [id, source] of [[1, 'IMMEDIATE'], [2, 'SCHEDULED']]) {
    await db.prepare(`INSERT INTO runs(id,task_id,run_key,source,slot_at,status,bot_id,delta_json,buttons_json,created_at)
      VALUES(?,1,?,?,0,'PENDING','222222','[]','[]',0)`).run(id, String(id), source);
    await db.prepare(`INSERT INTO deliveries(run_id,target_id,chat_id,title,status) VALUES(?,1,'-1001','fixture','PENDING')`).run(id);
  }
  await db.prepare(`INSERT INTO deliveries(run_id,target_id,chat_id,title,status) VALUES(1,2,'-1002','in flight','SENDING')`).run();
  // Register the real endpoint without starting a bot, HTTP listener or scheduler.
  const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const start = source.indexOf("app.post('/api/tasks/:id/status'");
  const end = source.indexOf("app.post('/api/tasks/:id/send'", start);
  assert.ok(start > 0 && end > start);
  let handler;
  vm.runInNewContext(source.slice(start, end), { db, nextSlot, currentBot: () => ({ id: '222222' }), route: fn => fn, app: { post: (_path, fn) => { handler = fn; } } });
  let response;
  const act = action => handler({ params: { id: '1' }, body: { action } }, { json: value => { response = value; } });
  await act('pause');
  assert.deepEqual((await db.prepare('SELECT status FROM deliveries ORDER BY id').all()).map(d => d.status), ['PENDING', 'CANCELLED', 'SENDING']);
  await act('stop');
  assert.equal(response.status, 'STOPPED'); assert.equal(response.next_at, null);
  assert.deepEqual((await db.prepare('SELECT status FROM deliveries ORDER BY id').all()).map(d => d.status), ['CANCELLED', 'CANCELLED', 'SENDING']);
  await act('activate');
  assert.equal(response.status, 'DRAFT'); assert.equal(response.next_at, null);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM deliveries WHERE status='PENDING'").get()).count, 0);
});
