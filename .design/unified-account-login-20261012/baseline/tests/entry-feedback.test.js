import test from 'node:test';
import assert from 'node:assert/strict';
import { entryCommand, entryReply } from '../server/entry-feedback.js';

test('entryCommand normalizes bot mentions and arguments', () => {
  assert.equal(entryCommand('/start@my_bot welcome'), 'start');
  assert.equal(entryCommand('/HELP'), 'help');
  assert.equal(entryCommand('hello'), '');
});

test('start gives admins the workbench button and non-admins an actionable response', () => {
  const admin = entryReply({ command: 'start', isAdmin: true, publicUrl: 'https://example.test' });
  assert.equal(admin.text, '欢迎使用飞机助手。');
  assert.equal(admin.reply_markup.inline_keyboard[0][0].web_app.url, 'https://example.test');

  const visitor = entryReply({ command: 'start', isAdmin: false, publicUrl: 'https://example.test' });
  assert.match(visitor.text, /暂无管理权限/);
  assert.equal(visitor.reply_markup, undefined);
});

test('login reports missing permission and help explains the available entry points', () => {
  const denied = entryReply({ command: 'login', isAdmin: false });
  assert.match(denied.text, /网页登录权限/);
  const help = entryReply({ command: 'help', isAdmin: false });
  assert.match(help.text, /\/start/);
  assert.match(help.text, /\/login/);
});

test('unknown commands receive guidance instead of silence', () => {
  const reply = entryReply({ command: 'unknown', isAdmin: false });
  assert.match(reply.text, /暂不支持/);
});
