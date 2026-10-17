import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';
import { createAccountAuth, requireAccount } from '../server/account-auth.js';
import { canAccessBot } from '../server/request-context.js';

// Minimal local storage fixture. All requests use the production auth routes/middleware.
export async function accountFixture(options = {}) {
  const sessions = new Map(), settings = new Map(options.settings || []);
  const publishers = options.preview ? [{id:'1001',username:'first',status:'ACTIVE'},{id:'1002',username:'second',status:'DISABLED'}] : [{id:'1001',username:'first'},{id:'1002',username:'second'}];
  const db = {
    prepare(sql) { return {
      async get(...args) {
        if (sql.startsWith('SELECT value FROM settings')) return {value:settings.get(args[0])};
        if (sql.startsWith('SELECT * FROM browser_sessions')) {
          const row=sessions.get(args[0]);return row && row.expires_at > args[1] ? row : undefined;
        }
        throw new Error(`Unexpected fixture get: ${sql}`);
      },
      async all() { if(sql.startsWith('SELECT id') || sql.startsWith('SELECT p.id')) return publishers; throw new Error(`Unexpected fixture all: ${sql}`); },
      async run(...args) {
        if(sql.startsWith('INSERT INTO browser_sessions')) {
          const [session_hash,admin_id,expires_at,created_at,last_seen,login_username]=args;
          sessions.set(session_hash,{session_hash,admin_id,expires_at,created_at,last_seen,login_username});
        } else if(sql.includes('DELETE FROM browser_sessions WHERE login_username')) {
          for(const [key,row] of sessions) if(row.login_username===args[0]) sessions.delete(key);
        } else if(sql.startsWith('DELETE FROM browser_sessions')) sessions.delete(args[0]);
        else if(sql.startsWith('UPDATE browser_sessions SET last_seen')) sessions.get(args[1]).last_seen=args[0];
        else if(sql.startsWith('INSERT INTO settings')) { if(!sql.includes('DO NOTHING') || !settings.has(args[0])) settings.set(args[0],args[1]); }
        else throw new Error(`Unexpected fixture run: ${sql}`);
        return {changes:1};
      },
    }; },
    transaction(fn) { return async () => fn(); },
  };
  const credentials={salt:'local-fixture',accounts:options.accounts || [
    {username:'wz9946',password:'owner-fixture-password'},
    {username:'operator',password:'operator-fixture-password',publisherIds:['1001']},
  ]};
  const auth=await createAccountAuth(db,credentials);
  const app=express();app.use(express.json());auth.routes(app);
  app.use('/api',requireAccount(auth));
  app.get('/api/bootstrap',(req,res)=>{
    const available=publishers.filter(bot=>canAccessBot(req.admin,bot.id));
    const selected=available.find(bot=>bot.id===req.get('x-publisher-id'))||available[0];
    res.json({admin:req.admin,publishers:available,publisher:selected?{id:selected.id,username:selected.username,status:selected.status||'ACTIVE'}:null,targets:[],tasks:[],timezone:'Asia/Shanghai'});
  });
  app.get('/api/bots/:id',(req,res)=>canAccessBot(req.admin,req.params.id)?res.json({ok:true}):res.status(403).json({error:'没有此机器人的操作权限'}));
  if(options.preview){
    const conversations=[
      {bot_id:'1001',chat_id:'2300001',chat_type:'private',title:'林小满',username:'linxiaoman',unread_count:2,last_message_text:'好的，稍后确认文件。',last_message_at:Date.now()-2*60_000,avatar_file_id:null},
      {bot_id:'1001',chat_id:'2300002',chat_type:'private',title:'设计讨论',username:'design_team',unread_count:0,last_message_text:'这是一条较长的会话摘要，自动截断后仍可以快速识别上下文。',last_message_at:Date.now()-18*60_000,avatar_file_id:null},
      {bot_id:'1001',chat_id:'2300003',chat_type:'private',title:'陈予安',username:'chenyuan',unread_count:1,last_message_text:'[图片] 产品方案',last_message_at:Date.now()-90*60_000,avatar_file_id:null},
    ];
    const messages=new Map([['2300001',[
      {id:1,chat_id:'2300001',telegram_message_id:'9001',direction:'IN',text:'你好，想确认一下活动安排。',entities_json:'[]',sent_at:Date.now()-35*60_000,status:'SUCCESS'},
      {id:2,chat_id:'2300001',telegram_message_id:'9002',direction:'OUT',text:'可以，我帮你核对后回复。',entities_json:'[]',sent_at:Date.now()-30*60_000,status:'SUCCESS'},
      {id:3,chat_id:'2300001',telegram_message_id:'9003',direction:'IN',text:'好的，稍后确认文件。',entities_json:'[]',sent_at:Date.now()-2*60_000,status:'SUCCESS'},
    ]]]);
    app.get('/api/chat/conversations',(req,res)=>{
      const botId=req.get('x-publisher-id')||'1001',q=String(req.query.q||'').toLowerCase();
      const rows=conversations.filter(row=>row.bot_id===botId&&(!q||`${row.title} ${row.username} ${row.last_message_text}`.toLowerCase().includes(q)));
      res.json({rows,totalUnread:rows.reduce((sum,row)=>sum+row.unread_count,0),cursor:Date.now(),next:null});
    });
    app.get('/api/chat/updates',(_req,res)=>res.json({rows:[],cursor:0}));
    app.get('/api/chat/conversations/:chatId/messages',(req,res)=>res.json({rows:messages.get(req.params.chatId)||[],next:null}));
    app.post('/api/chat/conversations/:chatId/read',(_req,res)=>res.json({ok:true}));
    app.post('/api/chat/conversations/:chatId/send',(req,res)=>{
      const chatId=req.params.chatId,delta=req.body?.delta?.ops||[],text=delta.map(op=>typeof op.insert==='string'?op.insert:'').join('').trim();
      const rows=messages.get(chatId)||[],id=String(Date.now());rows.push({id:Number(id),chat_id:chatId,telegram_message_id:id,direction:'OUT',text,entities_json:'[]',sent_at:Date.now(),status:'SUCCESS'});messages.set(chatId,rows);
      const row=conversations.find(item=>item.chat_id===chatId);if(row){row.last_message_text=text||'[附件]';row.last_message_at=Date.now();}
      res.json(rows.at(-1));
    });
    app.get('/api/inbox/status',(_req,res)=>res.json({status:'READY',enabled:true}));
  }
  app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,options={})=>fetch(base+path,{...options,headers:{origin:base,'content-type':'application/json',...options.headers}});
  const login=async(username='wz9946',password='owner-fixture-password')=>{
    const response=await request('/auth/login',{method:'POST',body:JSON.stringify({username,password})});
    assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
  };
  return {app,base,request,login,auth,settings,sessions,db,credentials,hash:cookie=>crypto.createHash('sha256').update(cookie.split('=')[1]).digest('hex'),close:()=>new Promise(resolve=>server.close(resolve))};
}
