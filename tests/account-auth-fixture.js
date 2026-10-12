import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';
import { createAccountAuth, requireAccount } from '../server/account-auth.js';
import { canAccessBot } from '../server/request-context.js';

// Minimal local storage fixture. All requests use the production auth routes/middleware.
export async function accountFixture() {
  const sessions = new Map(), settings = new Map();
  const publishers = [{id:'1001',username:'first'},{id:'1002',username:'second'}];
  const db = {
    prepare(sql) { return {
      async get(...args) {
        if (sql.startsWith('SELECT value FROM settings')) return {value:settings.get(args[0])};
        if (sql.startsWith('SELECT * FROM browser_sessions')) {
          const row=sessions.get(args[0]);return row && row.expires_at > args[1] ? row : undefined;
        }
        throw new Error(`Unexpected fixture get: ${sql}`);
      },
      async all() { if(sql.startsWith('SELECT id')) return publishers; throw new Error(`Unexpected fixture all: ${sql}`); },
      async run(...args) {
        if(sql.startsWith('INSERT INTO browser_sessions')) {
          const [session_hash,admin_id,expires_at,created_at,last_seen,login_username]=args;
          sessions.set(session_hash,{session_hash,admin_id,expires_at,created_at,last_seen,login_username});
        } else if(sql.startsWith('DELETE FROM browser_sessions')) sessions.delete(args[0]);
        else if(sql.startsWith('UPDATE browser_sessions SET last_seen')) sessions.get(args[1]).last_seen=args[0];
        else if(sql.startsWith('INSERT INTO settings')) settings.set(args[0],args[1]);
        else throw new Error(`Unexpected fixture run: ${sql}`);
        return {changes:1};
      },
    }; },
    transaction(fn) { return async () => fn(); },
  };
  const auth=await createAccountAuth(db,{salt:'local-fixture',accounts:[
    {username:'wz9946',password:'owner-fixture-password'},
    {username:'operator',password:'operator-fixture-password',publisherIds:['1001']},
  ]});
  const app=express();app.use(express.json());auth.routes(app);
  app.use('/api',requireAccount(auth));
  app.get('/api/bootstrap',(req,res)=>res.json({admin:req.admin,publishers:[],targets:[],tasks:[]}));
  app.get('/api/bots/:id',(req,res)=>canAccessBot(req.admin,req.params.id)?res.json({ok:true}):res.status(403).json({error:'没有此机器人的操作权限'}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,options={})=>fetch(base+path,{...options,headers:{origin:base,'content-type':'application/json',...options.headers}});
  const login=async(username='wz9946',password='owner-fixture-password')=>{
    const response=await request('/auth/login',{method:'POST',body:JSON.stringify({username,password})});
    assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
  };
  return {app,base,request,login,auth,settings,sessions,hash:cookie=>crypto.createHash('sha256').update(cookie.split('=')[1]).digest('hex'),close:()=>new Promise(resolve=>server.close(resolve))};
}
