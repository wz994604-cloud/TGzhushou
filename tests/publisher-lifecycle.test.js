import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as publishers from '../server/publishers.js';
import { createScheduler } from '../server/scheduler.js';
const key = Buffer.alloc(32, 1).toString('base64');
function fixture() {
  const raw = new DatabaseSync(':memory:'); raw.exec(fs.readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
  const db={prepare:sql=>{const s=raw.prepare(sql);return {get:async(...a)=>s.get(...a),all:async(...a)=>s.all(...a),run:async(...a)=>s.run(...a)}},transaction:fn=>async(...a)=>fn(...a)};
  return {raw,db};
}
test('disable/remove retain history, cancel pending work; rebind never resumes tasks',async()=>{
  const {raw,db}=fixture();
  await publishers.savePublisher(db,key,{id:'12345',username:'bot'},'token');
  raw.exec(`INSERT INTO tasks VALUES(1,'test','[]','[]','[]','{"kind":"MANUAL"}',NULL,'12345','ACTIVE',123,1,1);
    INSERT INTO runs VALUES(1,1,'one','IMMEDIATE',1,'PENDING','12345','[]','[]',NULL,1);
    INSERT INTO deliveries(id,run_id,target_id,chat_id,title,status) VALUES(1,1,1,'1','a','PENDING'),(2,1,2,'2','b','SUCCESS'),(3,1,3,'3','c','UNKNOWN');`);
  await publishers.setPublisherStatus(db,'12345','DISABLED');
  assert.equal(await publishers.getPublisher(db,key,'12345'),null);
  assert.equal((await publishers.listPublishers(db))[0].status,'DISABLED');
  assert.deepEqual(raw.prepare('SELECT status FROM deliveries ORDER BY id').all().map(r=>r.status),['CANCELLED','SUCCESS','UNKNOWN']);
  await publishers.setPublisherStatus(db,'12345','REMOVED');
  assert.equal((await publishers.listPublishers(db)).length,0);
  await publishers.savePublisher(db,key,{id:'12345',username:'bot'},'new-token');
  assert.equal((await publishers.getPublisher(db,key,'12345')).token,'new-token');
  assert.equal(raw.prepare('SELECT status FROM tasks').get().status,'PAUSED');raw.close();
});
test('token replacement rejects another identity without changing token',async()=>{
  const {raw,db}=fixture(); await publishers.savePublisher(db,key,{id:'12345'},'old');
  await assert.rejects(()=>publishers.updatePublisherToken(db,key,'12345',{id:'67890'},'new'),/身份/);
  assert.equal((await publishers.getPublisher(db,key,'12345')).token,'old');raw.close();
});
test('scheduler rechecks active state after remote permission lookup before sending',async()=>{
  const {raw,db}=fixture();await publishers.savePublisher(db,key,{id:'12345'},'token');
  raw.exec(`INSERT INTO targets VALUES(1,'12345','99','target','group',NULL,1,NULL);
    INSERT INTO tasks VALUES(1,'test','[{"insert":"hello"}]','[]','[1]','{"kind":"MANUAL"}',NULL,'12345','DRAFT',NULL,1,1);`);
  let sends=0; const scheduler=createScheduler(db,{configKey:key},{botCall:async(_t,method)=>{if(method==='getChatMember'){await publishers.setPublisherStatus(db,'12345','DISABLED');return {status:'administrator'};}sends++;return {message_id:1};}});
  await scheduler.queueNow(1,'00000000-0000-0000-0000-000000000000','12345');await scheduler.tick();assert.equal(sends,0);raw.close();
});
test('retry only confirmed failed targets, preserve successful and unknown deliveries',async()=>{
  const {raw,db}=fixture();await publishers.savePublisher(db,key,{id:'12345'},'token');
  raw.exec(`INSERT INTO tasks VALUES(1,'test','[]','[]','[]','{"kind":"MANUAL"}',NULL,'12345','DRAFT',NULL,1,1);
    INSERT INTO runs VALUES(1,1,'one','IMMEDIATE',1,'COMPLETED','12345','[]','[]',NULL,1);
    INSERT INTO deliveries(id,run_id,target_id,chat_id,title,status) VALUES(1,1,1,'1','a','FAILED'),(2,1,2,'2','b','SUCCESS'),(3,1,3,'3','c','UNKNOWN');`);
  const scheduler=createScheduler(db,{configKey:key});
  assert.equal((await scheduler.retryFailed('runs',1,'12345')).count,1);
  assert.deepEqual(raw.prepare('SELECT status FROM deliveries ORDER BY id').all().map(r=>r.status),['PENDING','SUCCESS','UNKNOWN']);raw.close();
});
test('referenced media deletion is blocked, unused entry can be removed',async()=>{
  const {deleteUnusedMedia}=await import('../server/media-protection.js');
  const {raw,db}=fixture();raw.exec(`INSERT INTO media VALUES(1,'a','image/png',1,'fixture',1),(2,'b','image/png',1,'fixture2',1);
    INSERT INTO tasks VALUES(1,'test','[]','[]','[]','{"kind":"MANUAL"}',1,'12345','DRAFT',NULL,1,1);`);
  await assert.rejects(()=>deleteUnusedMedia(db,1),/引用/);assert.equal((await deleteUnusedMedia(db,2)).deleted,true);raw.close();
});
test('publisher management routes enforce manager role and preserve identity',async()=>{
  const express=(await import('express')).default;
  const {registerPublisherRoutes}=await import('../server/routes-publishers.js');
  const {route}=await import('../server/request-context.js');
  const {raw,db}=fixture();await publishers.savePublisher(db,key,{id:'12345'},'old');
  const audits=[],revoked=[];const app=express();app.use(express.json());app.use((req,_res,next)=>{req.admin={canManageBots:req.get('x-owner')==='yes',username:'wz9946'};next();});
  registerPublisherRoutes(app,{db,configKey:key,entryToken:'entry',route,botCall:async()=>({id:67890,is_bot:true}),accountAuth:{audit:async e=>audits.push(e),revokeBotAccess:async id=>revoked.push(id)}});
  app.use((error,_req,res,_next)=>res.status(400).json({error:error.message}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/publishers/12345`;
    assert.equal((await fetch(url+'/status',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"disable"}'})).status,403);
    assert.equal((await fetch(url+'/token',{method:'PUT',headers:{'content-type':'application/json','x-owner':'yes'},body:JSON.stringify({token:'67890:abcdefghijklmnopqrst'})})).status,400);
    assert.equal((await publishers.getPublisher(db,key,'12345')).token,'old');
    assert.equal((await fetch(url,{method:'DELETE',headers:{'x-owner':'yes'}})).status,200);
    assert.deepEqual(revoked,['12345']);assert.equal(audits[0].action,'publisher.remove');
  } finally {await new Promise(r=>server.close(r));raw.close();}
});
test('disabling during broadcast sends no later recipients and preserves in-flight success',async()=>{
  const {raw,db}=fixture();await publishers.savePublisher(db,key,{id:'12345'},'token');let sends=0;
  const scheduler=createScheduler(db,{configKey:key},{botCall:async()=>{sends++;await publishers.setPublisherStatus(db,'12345','DISABLED');return {message_id:10};}});
  await scheduler.queueBroadcast({name:'test',deltaJson:'[{"insert":"hello"}]',buttonsJson:'[]',players:[{telegramId:'1'},{telegramId:'2'}]},'12345');
  await scheduler.tick();assert.equal(sends,1);
  assert.deepEqual(raw.prepare('SELECT status FROM broadcast_deliveries ORDER BY id').all().map(r=>r.status),['SUCCESS','CANCELLED']);raw.close();
});
test('revoked queue owner cancels unsent broadcasts without retrying them later',async()=>{
  const {raw,db}=fixture();await publishers.savePublisher(db,key,{id:'12345'},'token');let permitted=true,sends=0;
  const scheduler=createScheduler(db,{configKey:key,canExecuteOwner:async(owner,id)=>permitted && owner.account_id==='stable-a' && id==='12345'},{botCall:async()=>{sends++;return {message_id:1};}});
  await scheduler.queueBroadcast({name:'test',deltaJson:'[{"insert":"hello"}]',buttonsJson:'[]',players:[{telegramId:'1'}]},'12345',{id:'stable-a',username:'operator'});
  permitted=false;await scheduler.tick();assert.equal(sends,0);
  assert.equal(raw.prepare('SELECT status FROM broadcast_deliveries').get().status,'CANCELLED');
  permitted=true;await scheduler.tick();assert.equal(sends,0);raw.close();
});
test('scheduled owner revocation pauses task; immediate run rechecks owner after permission lookup',async()=>{
  const {raw,db}=fixture();await publishers.savePublisher(db,key,{id:'12345'},'token');let permitted=true,sends=0;
  raw.exec(`INSERT INTO targets VALUES(1,'12345','99','target','group',NULL,1,NULL);
    INSERT INTO tasks VALUES(1,'test','[{"insert":"hello"}]','[]','[1]','{"kind":"MANUAL"}',NULL,'12345','DRAFT',NULL,1,1);`);
  const actor={id:'stable-a',username:'operator'};
  const scheduler=createScheduler(db,{configKey:key,canExecuteOwner:async()=>permitted},{botCall:async(_token,method)=>{if(method==='getChatMember'){permitted=false;return {status:'administrator'};}sends++;return {message_id:1};}});
  await scheduler.recordOwner('tasks',1,actor);
  await scheduler.queueNow(1,'00000000-0000-0000-0000-000000000000','12345',actor);
  await scheduler.tick();assert.equal(sends,0);assert.equal(raw.prepare('SELECT status FROM deliveries').get().status,'CANCELLED');
  raw.exec("UPDATE tasks SET status='ACTIVE',next_at=1");await scheduler.queueDue(Date.now());
  assert.equal(raw.prepare('SELECT status FROM tasks').get().status,'PAUSED');raw.close();
});
