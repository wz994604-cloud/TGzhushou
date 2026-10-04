import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {openDatabase} from '../server/db.js';
import {createBrowserAuth} from '../server/browser-auth.js';
const accounts=[{username:'wz9946',password:'owner-test',publisherIds:[]}, {username:'operator',password:'operator-test',publisherIds:['333333']}];
async function fixture(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tgzhushou-player-auth-'));const db=await openDatabase({localFile:path.join(dir,'test.db')});t.after(async()=>{await db.close();fs.rmSync(dir,{recursive:true,force:true});});return db;}

test('browser sessions retain account identity; only exact owner has management rights and scope follows current account',async t=>{
 const db=await fixture(t),auth=await createBrowserAuth(db,['123'],'https://test.local',{accounts});const app=express();app.use(express.json());auth.routes(app);
 const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const login=async(username,password)=>{const r=await fetch(base+'/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({username,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 const owner=await login('wz9946','owner-test'),operator=await login('operator','operator-test');
 const req=cookie=>({method:'GET',get:key=>key==='cookie'?cookie:''});
 assert.equal((await auth.authenticate(req(owner))).username,'wz9946');assert.equal((await auth.authenticate(req(owner))).canManageBots,true);assert.equal((await auth.authenticate(req(owner))).canManageAccounts,true);assert.equal((await auth.authenticate(req(owner))).publisherIds,undefined);
 assert.equal((await auth.authenticate(req(operator))).canManageBots,false);assert.deepEqual((await auth.authenticate(req(operator))).publisherIds,['333333']);
 const withoutTelegramIds=await createBrowserAuth(db,[],'https://test.local',{accounts});assert.equal((await withoutTelegramIds.authenticate(req(operator))).username,'operator');
 const removed=await createBrowserAuth(db,['123'],'https://test.local',{accounts:[accounts[0]]});assert.equal(await removed.authenticate(req(operator)),null);
 const changed=await createBrowserAuth(db,['123'],'https://test.local',{accounts:[accounts[0],{...accounts[1],publisherIds:[]}]});assert.deepEqual((await changed.authenticate(req(operator))).publisherIds,[]);
 assert.equal(await auth.authenticate({...req(owner),method:'POST'}),null);
});

test('old identity-less sessions are retained but expired; Telegram login links never acquire guessed owner privileges',async t=>{
 const db=await fixture(t);await db.exec('ALTER TABLE browser_sessions DROP COLUMN login_username');const raw=crypto.randomBytes(32).toString('base64url');
 await db.prepare('INSERT INTO browser_sessions VALUES(?,?,?,?,?)').run(crypto.createHash('sha256').update(raw).digest('hex'),'123',Date.now()+100000,1,1);
 const auth=await createBrowserAuth(db,['123'],'https://test.local',{accounts});
 assert.equal(await auth.authenticate({method:'GET',get:key=>key==='cookie'?'tgzhushou_session='+raw:''}),null);assert.equal((await db.prepare('SELECT COUNT(*) n FROM browser_sessions').get()).n,1);
 const app=express();app.use(express.json());auth.routes(app);const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));
 const token=new URL(await auth.issueLink('123')).hash.slice(7);const r=await fetch('http://127.0.0.1:'+server.address().port+'/auth/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(r.status,200);
 const cookie=r.headers.get('set-cookie').split(';')[0];assert.equal((await auth.authenticate({method:'GET',get:key=>key==='cookie'?cookie:''})).canManageBots,false);
 await assert.rejects(async () => await createBrowserAuth(db,['123'],'',{accounts:[{...accounts[1],publisherIds:'all'}]}),/publisherIds/);
});
