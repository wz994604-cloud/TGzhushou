import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {openDatabase} from '../server/db.js';
import {createBrowserAuth} from '../server/browser-auth.js';
const accounts=[{username:'wz994604',password:'owner-test'}, {username:'operator',password:'operator-test',publisherIds:['333333']}];
function fixture(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tgzhushou-player-auth-'));const db=openDatabase({localFile:path.join(dir,'test.db')});t.after(async()=>{await db.close();fs.rmSync(dir,{recursive:true,force:true});});return db;}

test('browser sessions retain account identity; only exact owner has management rights and scope follows current account',async t=>{
 const db=fixture(t),auth=createBrowserAuth(db,['123'],'https://test.local',{accounts});const app=express();app.use(express.json());auth.routes(app);
 const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const login=async(username,password)=>{const r=await fetch(base+'/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({username,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 const owner=await login('wz994604','owner-test'),operator=await login('operator','operator-test');
 const req=cookie=>({method:'GET',get:key=>key==='cookie'?cookie:''});
 assert.equal(auth.authenticate(req(owner)).username,'wz994604');assert.equal(auth.authenticate(req(owner)).canManageBots,true);
 assert.equal(auth.authenticate(req(operator)).canManageBots,false);assert.deepEqual(auth.authenticate(req(operator)).publisherIds,['333333']);
 const removed=createBrowserAuth(db,['123'],'https://test.local',{accounts:[accounts[0]]});assert.equal(removed.authenticate(req(operator)),null);
 const changed=createBrowserAuth(db,['123'],'https://test.local',{accounts:[accounts[0],{...accounts[1],publisherIds:[]}]});assert.deepEqual(changed.authenticate(req(operator)).publisherIds,[]);
 assert.equal(auth.authenticate({...req(owner),method:'POST'}),null);
});

test('old identity-less sessions are retained but expired; Telegram login links never acquire guessed owner privileges',async t=>{
 const db=fixture(t);db.exec('ALTER TABLE browser_sessions DROP COLUMN login_username');const raw=crypto.randomBytes(32).toString('base64url');
 db.prepare('INSERT INTO browser_sessions VALUES(?,?,?,?,?)').run(crypto.createHash('sha256').update(raw).digest('hex'),'123',Date.now()+100000,1,1);
 const auth=createBrowserAuth(db,['123'],'https://test.local',{accounts});
 assert.equal(auth.authenticate({method:'GET',get:key=>key==='cookie'?'tgzhushou_session='+raw:''}),null);assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_sessions').get().n,1);
 const app=express();app.use(express.json());auth.routes(app);const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));
 const token=new URL(auth.issueLink('123')).hash.slice(7);const r=await fetch('http://127.0.0.1:'+server.address().port+'/auth/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(r.status,200);
 const cookie=r.headers.get('set-cookie').split(';')[0];assert.equal(auth.authenticate({method:'GET',get:key=>key==='cookie'?cookie:''}).canManageBots,false);
 assert.throws(()=>createBrowserAuth(db,['123'],'',{accounts:[{...accounts[1],publisherIds:'all'}]}),/publisherIds/);
});
