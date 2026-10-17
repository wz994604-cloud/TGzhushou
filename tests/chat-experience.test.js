import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeKey, selectConversations, scrollPosition, safeMessageHtml} from '../src/chat-experience.js';
import {createImageLoader} from '../src/image-loader.js';
test('account and robot isolate private drafts',()=>{
 assert.notEqual(scopeKey('a','1','2'),scopeKey('b','1','2'));
 assert.notEqual(scopeKey('a','1','2'),scopeKey('a','2','2'));
});
test('conversation preferences filter, pin and recover archive after new messages',()=>{
 const rows=[{chat_id:'1',last_message_at:10,unread_count:0},{chat_id:'2',last_message_at:20,unread_count:1}];
 const prefs={'1':{pinned:true},'2':{archivedAt:25}};
 assert.deepEqual(selectConversations(rows,prefs,'all').map(x=>x.chat_id),['1']);
 rows[1].last_message_at=30;assert.deepEqual(selectConversations(rows,prefs,'all').map(x=>x.chat_id),['1','2']);
 assert.equal(selectConversations(rows,prefs,'unread').length,1);
});
test('history preserves anchor and new messages do not force scroll',()=>{
 assert.equal(scrollPosition({top:120,height:1000,client:400},1200,'older'),320);
 assert.equal(scrollPosition({top:120,height:1000,client:400},1200,'update'),120);
 assert.equal(scrollPosition({top:600,height:1000,client:400},1200,'update'),800);
});
test('message links and rich text are escaped and only safe schemes linked',()=>{
 assert.match(safeMessageHtml('<script>\nhttps://example.com'),/&lt;script&gt;/);
 assert.match(safeMessageHtml('hello',[{type:'bold',offset:0,length:5}]),/<strong>hello<\/strong>/);
 assert.doesNotMatch(safeMessageHtml('evil',[{type:'text_link',offset:0,length:4,url:'javascript:alert(1)'}]),/href=/);
});
test('image cache separates scope and clear invalidates pending results',async()=>{
 let calls=0;const load=createImageLoader(async()=>new Blob([String(++calls)]));
 assert.equal(await (await load('a')).text(),'1');load.clear();assert.equal(await (await load('a')).text(),'2');
});
