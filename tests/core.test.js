import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDatabase, setSetting, encryptToken, decryptToken } from '../server/db.js';
import { createScheduler } from '../server/scheduler.js';
import { nextSlot, normalizeSchedule } from '../server/schedule.js';
import { renderDelta, normalizeButtons, keyboard } from '../server/format.js';
import { configKey, publisherToken } from './helpers.js';
import { sendPhoto, multipartCaptionEntities } from '../server/telegram.js';

const at = value => Date.parse(`${value}+08:00`);
test('daily start, inclusive aligned end, non-aligned end and following day', () => {
  const s=normalizeSchedule({kind:'DAILY',start:'01:00',end:'05:00',interval:30});
  assert.equal(nextSlot(s,at('2030-01-02T00:59:59')),at('2030-01-02T01:00:00'));
  assert.equal(nextSlot(s,at('2030-01-02T05:00:00')),at('2030-01-02T05:00:00'));
  assert.equal(nextSlot(s,at('2030-01-02T05:00:01')),at('2030-01-03T01:00:00'));
  assert.equal(nextSlot({...s,interval:50},at('2030-01-02T04:20:01')),at('2030-01-03T01:00:00'));
});
test('cross-midnight, resume, once, manual and invalid intervals', () => {
  const s=normalizeSchedule({kind:'DAILY',start:'22:00',end:'02:00',interval:60});
  assert.equal(nextSlot(s,at('2030-01-02T00:10:00')),at('2030-01-02T01:00:00'));
  assert.equal(nextSlot(s,at('2030-01-02T02:00:01')),at('2030-01-02T22:00:00'));
  assert.equal(nextSlot({kind:'MANUAL'},0),null);
  assert.equal(nextSlot({kind:'ONCE',at:100},101),null);
  assert.equal(nextSlot({kind:'ONCE',at:100},100),100);
  assert.throws(()=>normalizeSchedule({kind:'DAILY',start:'22:00',end:'22:00',interval:1}));
  assert.throws(()=>normalizeSchedule({kind:'DAILY',start:'22:00',end:'02:00',interval:0}));
});
test('text links and custom emojis preserve UTF-16 entity offsets', () => {
  const r=renderDelta([{insert:'🙂 '},{insert:{customEmoji:{id:'5432101234567890123',alt:'🔥'}}},{insert:'进入频道',attributes:{link:'https://t.me/example',bold:true}},{insert:'\n'}]);
  assert.equal(r.text,'🙂 🔥进入频道');
  assert.deepEqual(r.entities[0],{type:'custom_emoji',offset:3,length:2,custom_emoji_id:'5432101234567890123'});
  assert.equal(r.entities.find(e=>e.type==='text_link').offset,5);
  assert.throws(()=>renderDelta([{insert:'x',attributes:{link:'javascript:alert(1)'}}]));
});
test('photo captions keep entity offsets after multipart LF to CRLF serialization', async t => {
  const transformed = multipartCaptionEntities('前\n🎁链接', [{ type:'custom_emoji', offset:2, length:2 }]);
  assert.deepEqual(transformed, [{ type:'custom_emoji', offset:3, length:2 }]);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, options) => {
    const body = await new Response(options.body).text();
    const match = body.match(/name="caption_entities"\r\n\r\n([\s\S]*?)\r\n------/);
    const entities = JSON.parse(match[1]);
    assert.equal(entities[0].offset, 3);
    return Response.json({ ok:true, result:{ message_id:1, caption_entities:entities } });
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-photo-')); const file = path.join(dir, 'x.jpg'); fs.writeFileSync(file, 'x');
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const result = await sendPhoto('222222:LOCAL_TEST_PUBLISH_TOKEN_123456789', '-1001', file, 'image/jpeg', '前\n🎁链接', [{ type:'custom_emoji', offset:2, length:2, custom_emoji_id:'5432101234567890123' }], null);
  assert.equal(result.message_id, 1);
});
test('native button colors and custom emoji field; unsafe URLs rejected', () => {
  const b=normalizeButtons([{text:'进入',url:'https://t.me/example',style:'success',row:0,iconId:'5432101234567890123',iconAlt:'🔥'}]);
  assert.deepEqual(keyboard(b).inline_keyboard[0][0],{text:'进入',url:'https://t.me/example',style:'success',icon_custom_emoji_id:'5432101234567890123'});
  assert.throws(()=>normalizeButtons([{text:'进入',url:'javascript:alert(1)'}]));
  assert.throws(()=>normalizeButtons([{text:'进入',url:'https://example.com',style:'pink'}]));
  const emojiOnly=normalizeButtons([{text:'',url:'https://t.me/example',iconId:'5432101234567890123',iconAlt:'🔥'}]);
  assert.equal(keyboard(emojiOnly).inline_keyboard[0][0].text, '\u2800');
  assert.throws(()=>normalizeButtons([{text:'',url:'https://t.me/example'}]));
});
test('encrypted publisher credential and wrong-key rejection', () => {
  const value=encryptToken(publisherToken,configKey);assert.notEqual(value,publisherToken);assert.equal(decryptToken(value,configKey),publisherToken);
  assert.throws(()=>decryptToken(value,Buffer.alloc(32,9).toString('base64')));
});
async function fixture(t, transport) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tgzhushou-unit-'));
  const db=await openDatabase({localFile:path.join(dir,'test.db')}); t.after(async()=>{await db.close();fs.rmSync(dir,{recursive:true,force:true});});
  await setSetting(db,'publisher_token',encryptToken(publisherToken,configKey));await setSetting(db,'publisher_id','222222');
  for(const id of [1,2])await db.prepare('INSERT INTO targets(id,bot_id,chat_id,title,chat_type,can_publish) VALUES(?,?,?,?,?,1)').run(id,'222222',String(-1000-id),`target ${id}`,'channel');
  const result=await db.prepare(`INSERT INTO tasks(name,delta_json,buttons_json,target_ids_json,schedule_json,bot_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'DRAFT',?,?)`).run('test',JSON.stringify([{insert:'hello\n'}]),'[]','[1,2]','{"kind":"MANUAL"}','222222',Date.now(),Date.now());
  const api={botCall:async(_token,method,payload)=> method==='getChatMember'?{status:'administrator',can_post_messages:true}:transport(payload),sendPhoto:async()=>({message_id:8,caption_entities:[]})};
  return {db,id:Number(result.lastInsertRowid),scheduler:createScheduler(db,{configKey},api),dir,api};
}
test('immediate idempotency and isolated per-target failure',async t=>{
  const calls=[];const {db,id,scheduler}=await fixture(t,async p=>{calls.push(p.chat_id);if(p.chat_id==='-1002')throw Object.assign(new Error('Forbidden'),{telegramCode:403});return {message_id:1};});
  const key=crypto.randomUUID();assert.equal(await scheduler.queueNow(id,key),await scheduler.queueNow(id,key));await scheduler.tick();await scheduler.tick();
  assert.deepEqual(calls,['-1001','-1002']);assert.deepEqual((await db.prepare('SELECT status FROM deliveries ORDER BY id').all()).map(x=>x.status),['SUCCESS','FAILED']);
});
test('network ambiguity is UNKNOWN, not retried after scheduler restart',async t=>{
  let count=0;const f=await fixture(t,async()=>{count++;throw new Error('socket closed');});await f.scheduler.queueNow(f.id,crypto.randomUUID());await f.scheduler.tick();
  await createScheduler(f.db,{configKey},f.api).tick();assert.equal(count,2);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='UNKNOWN'").get().n,2);
});
test('schedule slot deduplication and missed-slot record',async t=>{
  const f=await fixture(t,async()=>({message_id:1}));const now=Date.now();
  f.db.prepare("UPDATE tasks SET status='ACTIVE',next_at=?,schedule_json=? WHERE id=?").run(now,JSON.stringify({kind:'ONCE',at:now}),f.id);
  await f.scheduler.queueDue(now);await f.scheduler.queueDue(now);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM runs').get().n,1);
  assert.equal(f.db.prepare('SELECT status FROM tasks').get().status,'COMPLETED');
  await createScheduler(f.db,{configKey},f.api).tick();assert.equal(f.db.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='SUCCESS'").get().n,2);
  f.db.prepare("UPDATE tasks SET status='ACTIVE',next_at=?,schedule_json=? WHERE id=?").run(now-3600000,JSON.stringify({kind:'DAILY',start:'01:00',end:'05:00',interval:30}),f.id);
  await f.scheduler.queueDue(now);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='SKIPPED'").get().n,2);
});
test('interrupted in-flight and removed targets are visible, never silent success',async t=>{
  const f=await fixture(t,async()=>({message_id:1}));await f.scheduler.queueNow(f.id,crypto.randomUUID());
  f.db.prepare("UPDATE deliveries SET status='SENDING',started_at=?").run(Date.now()-360000);await f.scheduler.tick();assert.equal(f.db.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='UNKNOWN'").get().n,2);
  f.db.prepare('DELETE FROM targets WHERE id=2').run();await f.scheduler.queueNow(f.id,crypto.randomUUID());await f.scheduler.tick();assert.equal(f.db.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='FAILED'").get().n,1);
});
test('custom emoji loss is recorded for both text and button',async t=>{
  const f=await fixture(t,async()=>({message_id:1,entities:[],reply_markup:{inline_keyboard:[]}}));
  f.db.prepare('UPDATE tasks SET delta_json=?,buttons_json=?').run(JSON.stringify([{insert:{customEmoji:{id:'5432101234567890123',alt:'🔥'}}},{insert:'\n'}]),JSON.stringify(normalizeButtons([{text:'go',url:'https://example.com',iconId:'5432101234567890123',iconAlt:'🔥'}])));
  await f.scheduler.queueNow(f.id,crypto.randomUUID());await f.scheduler.tick();const d=f.db.prepare('SELECT error_text FROM deliveries LIMIT 1').get();assert.match(d.error_text,/0\/1/);assert.match(d.error_text,/按钮专属表情/);
});
