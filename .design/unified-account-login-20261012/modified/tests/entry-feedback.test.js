import test from 'node:test';
import assert from 'node:assert/strict';
import { entryCommand, entryReply } from '../server/entry-feedback.js';
test('entryCommand normalizes bot mentions and arguments',()=>{
 assert.equal(entryCommand('/start@my_bot welcome'),'start');assert.equal(entryCommand('/HELP'),'help');assert.equal(entryCommand('hello'),'');
});
for(const command of ['start','login'])test(`${command} opens account login for every Telegram user`,()=>{
 const reply=entryReply({command,publicUrl:'https://example.test'});
 assert.equal(reply.reply_markup.inline_keyboard[0][0].web_app.url,'https://example.test');
 assert.match(reply.text,/账号密码/);assert.doesNotMatch(reply.text,/暂无管理权限|5 分钟|免密/);
 assert.match(entryReply({command}).text,/地址暂未配置/);
});
test('help and unknown commands explain public account login entry',()=>{
 assert.match(entryReply({command:'help'}).text,/\/login/);
 assert.match(entryReply({command:'unknown'}).text,/\/help/);
});
