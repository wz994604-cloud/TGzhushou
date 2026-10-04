import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {openDatabase, getSetting, encryptToken} from '../server/db.js';
import {createBrowserAuth} from '../server/browser-auth.js';
import {registerChatRoutes, saveIncoming} from '../server/chat.js';
import {configKey} from './helpers.js';

async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-inbox-'));
  const file=path.join(dir,'test.db'),db=await openDatabase({localFile:file});
  t.after(async()=>{await db.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {db,file};
}
async function serve(t,app) {
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return 'http://127.0.0.1:'+server.address().port;
}
test('only wz9946 creates accounts; hashed password, scope, duplicate, CSRF and restart',async t=>{
  const {db}=await fixture(t),accounts=[{username:'wz9946',password:'owner-password'},{username:'wz994604',password:'other-password'}];
  await db.prepare('INSERT INTO publishers(id,username,token,created_at,updated_at) VALUES(?,?,?,?,?)').run('222222','test','encrypted',1,1);
  const app=express();app.use(express.json());let auth=await createBrowserAuth(db,['123'],'https://test.local',{accounts});auth.routes(app);
  const base=await serve(t,app);
  const login=async(username,password)=>{const r=await fetch(base+'/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({username,password})});return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const owner=await login('wz9946','owner-password'),other=await login('wz994604','other-password');
  const input={username:'newoperator',password:'synthetic-password',publisherIds:['222222']};
  const create=(cookie,body=input,origin=base)=>fetch(base+'/auth/admin-accounts',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await create(other.cookie)).status,403);
  assert.equal((await create(owner.cookie,input,'https://other.test')).status,403);
  assert.equal((await create(owner.cookie,{...input,publisherIds:['999999']})).status,400);
  assert.equal((await create(owner.cookie,{...input,username:'wz994604'})).status,409);
  assert.equal((await create(owner.cookie)).status,201);
  assert.equal((await create(owner.cookie)).status,409);
  const saved=JSON.parse(await getSetting(db,'admin_accounts_v1'))[0];assert.ok(saved.passwordHash);assert.equal(saved.password,undefined);assert.ok(!JSON.stringify(saved).includes(input.password));
  const user=await login(input.username,input.password);assert.equal(user.status,200);
  const req={method:'GET',get:key=>key==='cookie'?user.cookie:''};
  assert.deepEqual((await auth.authenticate(req)).publisherIds,['222222']);assert.equal((await auth.authenticate(req)).canManageAccounts,false);assert.equal((await auth.authenticate(req)).canManageBots,false);
  assert.equal((await create(user.cookie,{...input,username:'another'})).status,403);
  assert.equal((await login(input.username,'wrong-password')).status,401);
  const list=await(await fetch(base+'/auth/admin-accounts',{headers:{cookie:owner.cookie}})).json();assert.ok(!JSON.stringify(list).includes('password'));
  auth=await createBrowserAuth(db,['123'],'https://test.local',{accounts});assert.equal((await auth.authenticate(req)).username,input.username);
});
test('disable affects own webhook only, preserves history, denies operators and supports re-enable',async t=>{
  const {db}=await fixture(t),app=express();app.use(express.json());
  let owner=true,url='https://test.local/tg/publisher/123',failDelete=false;const calls=[];
  app.use((req,_res,next)=>{req.admin={canManageBots:owner};next();});
  registerChatRoutes(app,{db,scheduler:{publisher:()=>({id:'123',token:'token'})},configKey,publicUrl:'https://test.local',botApi:async(_token,method,payload)=>{
    calls.push({method,payload});if(method==='getWebhookInfo')return {url};
    if(method==='deleteWebhook'){if(failDelete)throw new Error('Telegram unavailable');url='';}if(method==='setWebhook')url=payload.url;return true;
  }});
  app.use((error,_req,res,_next)=>res.status(502).json({error:error.message}));
  await db.prepare("INSERT INTO publisher_inbox(bot_id,enabled,webhook_status,secret) VALUES('123',1,'READY',?)").run(encryptToken('secret',configKey));
  await saveIncoming(db,'123',{message:{message_id:1,date:1760000000,chat:{id:55,type:'private'},from:{id:55,first_name:'test'},text:'retained'}});
  const base=await serve(t,app),post=route=>fetch(base+route,{method:'POST'});
  owner=false;assert.equal((await post('/api/inbox/disable')).status,403);assert.equal(calls.length,0);owner=true;
  failDelete=true;assert.equal((await post('/api/inbox/disable')).status,502);assert.equal((await db.prepare("SELECT enabled FROM publisher_inbox WHERE bot_id='123'").get()).enabled,1);failDelete=false;
  assert.equal((await post('/api/inbox/disable')).status,200);assert.equal((await db.prepare("SELECT enabled FROM publisher_inbox WHERE bot_id='123'").get()).enabled,0);
  assert.deepEqual(calls.find(call=>call.method==='deleteWebhook').payload,{drop_pending_updates:false});assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_messages').get()).n,1);
  assert.equal((await post('/api/inbox/enable')).status,200);assert.equal((await db.prepare("SELECT enabled FROM publisher_inbox WHERE bot_id='123'").get()).enabled,1);
  url='https://external.test/hook';const deletes=calls.filter(call=>call.method==='deleteWebhook').length;
  assert.equal((await post('/api/inbox/disable')).status,409);assert.equal(calls.filter(call=>call.method==='deleteWebhook').length,deletes);
});
