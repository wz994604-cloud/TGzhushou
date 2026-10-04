import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { verifyInitData } from '../server/auth.js';
import { entryToken, signedData } from './helpers.js';

test('both allowed admins receive /start button and pass Mini App auth; outsiders do not', async () => {
  // Exercise the actual registered webhook, with all Telegram calls mocked.
  const source = fs.readFileSync(process.env.ENTRY_SOURCE || new URL('../server/index.js', import.meta.url), 'utf8');
  const handlerSource = source.slice(source.indexOf("app.post('/tg/entry'"), source.indexOf("app.use('/api'"));
  assert.ok(handlerSource.length > 100);
  const ids = ['10000000001', '10000000002'];
  const sent = [];
  let handler;
  vm.runInNewContext(handlerSource, {
    app: { post: (route, fn) => { if (route === '/tg/entry') handler = fn; } },
    process: { env: { ENTRY_BOT_TOKEN: entryToken, PUBLIC_URL: 'https://example.com', ADMIN_TG_IDS: ids.join(',') } },
    crypto, Buffer, adminIds: ids, console,
    botCall: async (_token, method, payload) => { sent.push({ method, payload }); },
    safeTelegramError: error => error.message,
  });
  const secret = crypto.createHash('sha256').update(`entry:${entryToken}`).digest('hex');
  for (const id of [...ids, '10000000003']) {
    await handler({ get: () => secret, body: { message: { chat: { id: Number(id), type: 'private' }, from: { id: Number(id) }, text: '/start' } } }, { sendStatus: code => assert.equal(code, 200) });
  }
  assert.deepEqual(sent.map(call => String(call.payload.chat_id)), ids);
  for (const id of ids) {
    assert.equal(verifyInitData(signedData(Number(id)), entryToken, ids).id, id);
  }
  assert.throws(() => verifyInitData(signedData(10000000003), entryToken, ids));
  for (const call of sent) assert.equal(call.payload.reply_markup.inline_keyboard[0][0].web_app.url, 'https://example.com');
});
