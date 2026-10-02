import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { openDatabase, encryptToken } from '../server/db.js';
import { saveIncoming, registerChatRoutes } from '../server/chat.js';
import { createBrowserAuth } from '../server/browser-auth.js';
import { sendFormatted } from '../server/sender.js';
import { configKey } from './helpers.js';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tg-chat-test-'));
  const db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  return db;
}
const incoming=(id,chat=42,text='你好')=>({update_id:id,message:{message_id:id,date:1760000000+id,
  chat:{id:chat,type:'private'},from:{id:chat,first_name:'用户'},text}});

test('webhook messages are idempotent, isolated by bot and read state persists',t=>{
  const db=fixture(t);
  assert.equal(saveIncoming(db,'A',incoming(1)),true);
  assert.equal(saveIncoming(db,'A',incoming(1)),false);
  assert.equal(saveIncoming(db,'B',incoming(1)),true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_messages').get().n,2);
  assert.equal(db.prepare("SELECT unread_count FROM conversations WHERE bot_id='A'").get().unread_count,1);
  db.prepare("UPDATE conversations SET unread_count=0,last_read_message_id=last_message_id WHERE bot_id='A'").run();
  assert.equal(db.prepare("SELECT unread_count FROM conversations WHERE bot_id='A'").get().unread_count,0);
  for(const [kind,payload] of [['photo',{photo:[{file_id:'p1'}]}],['video',{video:{file_id:'v1'},caption:'视频'}],['document',{document:{file_id:'d1'}}]]) {
    const id={photo:2,video:3,document:4}[kind];
    assert.equal(saveIncoming(db,'A',{message:{...incoming(id).message,text:undefined,...payload}}),true);
    assert.equal(db.prepare('SELECT media_kind,file_id FROM chat_messages WHERE bot_id=? AND telegram_message_id=?').get('A',String(id)).media_kind,kind);
  }
  assert.equal(db.prepare("SELECT unread_count FROM conversations WHERE bot_id='B'").get().unread_count,1);
  saveIncoming(db,'A',{edited_message:{...incoming(1).message,text:'已编辑',edit_date:1760000100}});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_events WHERE bot_id='A'").get().n,5);
  assert.equal(db.prepare("SELECT text FROM chat_messages WHERE bot_id='A'").get().text,'已编辑');
  assert.equal(db.prepare("SELECT unread_count FROM conversations WHERE bot_id='A'").get().unread_count,3);
});

test('reply, rich text, custom emoji, buttons and media share formatted sender',async()=>{
  const calls=[],api={botCall:async(_t,method,payload)=>{calls.push({method,payload});return {message_id:9};},sendPhoto:async(...args)=>{calls.push({method:'sendPhoto',args});return {message_id:10};}};
  const delta=[{insert:'你好 '},{insert:{customEmoji:{id:'5432101234567890123',alt:'🔥'}}},{insert:'\n'}];
  await sendFormatted({token:'token',chatId:'42',delta,buttons:[{text:'打开',url:'https://t.me/example',style:'primary',row:0}],replyTo:'8',api});
  assert.equal(calls[0].method,'sendMessage');
  assert.equal(calls[0].payload.reply_parameters.message_id,8);
  assert.equal(calls[0].payload.entities[0].type,'custom_emoji');
  assert.equal(calls[0].payload.reply_markup.inline_keyboard[0][0].style,'primary');
  await sendFormatted({token:'token',chatId:'42',delta,media:{mime:'image/png',file_path:'unused'},api});
  assert.equal(calls[1].method,'sendPhoto');
});

test('external webhook is never overwritten, secret is required for own webhook',async t=>{
  const db=fixture(t), app=express(), calls=[];
  app.use(express.json());
  const bot={id:'123',token:'token'};
  registerChatRoutes(app,{db,scheduler:{publisher:()=>bot},configKey,publicUrl:'https://example.test',
    botApi:async(_token,method)=>{calls.push(method);if(method==='getWebhookInfo')return {url:'https://other.test/hook'};return true;}});
  const server=app.listen(0);t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const conflict=await fetch(base+'/api/inbox/enable',{method:'POST'});
  assert.equal(conflict.status,409);
  assert.deepEqual(calls,['getWebhookInfo']);
  const denied=await fetch(base+'/tg/publisher/123',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(incoming(1))});
  assert.equal(denied.status,403);
  db.prepare("INSERT OR REPLACE INTO publisher_inbox(bot_id,enabled,webhook_status,secret) VALUES('123',1,'READY',?)")
    .run(encryptToken('secret',configKey));
  const accepted=await fetch(base+'/tg/publisher/123',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'secret'},body:JSON.stringify(incoming(1))});
  assert.equal(accepted.status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_messages').get().n,1);
});

test('empty webhook can be enabled without altering another bot',async t=>{
  const db=fixture(t),app=express(),calls=[];app.use(express.json());
  registerChatRoutes(app,{db,scheduler:{publisher:()=>({id:'123',token:'token'})},configKey,publicUrl:'https://example.test',
    botApi:async(_token,method,payload)=>{calls.push({method,payload});return method==='getWebhookInfo'?{url:''}:true;}});
  const server=app.listen(0);t.after(()=>server.close());
  const result=await fetch(`http://127.0.0.1:${server.address().port}/api/inbox/enable`,{method:'POST'});
  assert.equal(result.status,200);
  assert.equal(calls[1].method,'setWebhook');
  assert.equal(calls[1].payload.url,'https://example.test/tg/publisher/123');
  assert.ok(calls[1].payload.secret_token);
  assert.equal(db.prepare("SELECT enabled FROM publisher_inbox WHERE bot_id='123'").get().enabled,1);
  for(const chat of [101,102,103])saveIncoming(db,'123',{message:{...incoming(1,chat).message,date:1760000000}});
  const base=`http://127.0.0.1:${server.address().port}`;
  const first=await(await fetch(base+'/api/chat/conversations?limit=2')).json();
  const second=await(await fetch(base+'/api/chat/conversations?limit=2&before='+encodeURIComponent(first.next))).json();
  assert.equal(first.rows.length,2);assert.equal(second.rows.length,1);
  assert.equal(new Set([...first.rows,...second.rows].map(row=>row.chat_id)).size,3);
});

test('browser link is one-time and session expires or logs out',async t=>{
  const db=fixture(t),auth=createBrowserAuth(db,['123'],'https://example.test'),link=auth.issueLink('123');
  const token=new URL(link).hash.slice('#login='.length),app=express();app.use(express.json());auth.routes(app);
  const server=app.listen(0);t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
  const first=await fetch(base+'/auth/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
  assert.equal(first.status,200);
  assert.match(first.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await fetch(base+'/auth/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})})).status,401);
  const cookie=first.headers.get('set-cookie').split(';')[0];
  assert.equal(auth.authenticate({method:'GET',get:name=>name==='cookie'?cookie:''})?.id,'123');
  db.prepare('UPDATE browser_sessions SET expires_at=0').run();
  assert.equal(auth.authenticate({method:'GET',get:name=>name==='cookie'?cookie:''}),null);
});
