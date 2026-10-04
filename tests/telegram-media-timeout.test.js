import test from 'node:test';
import assert from 'node:assert/strict';
import { sendPhoto } from '../server/telegram.js';

test('remote media download is protected by an abort signal before Telegram upload', async t => {
  const originalFetch = globalThis.fetch;
  const remote = 'https://example.com/media/test.jpg';
  let calls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (url, options = {}) => {
    calls++;
    if (calls === 1) {
      assert.equal(url, remote);
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(Buffer.from('image-bytes'), { status:200, headers:{ 'content-type':'image/jpeg' } });
    }
    assert.match(String(url), /api\.telegram\.org\/bot/);
    return Response.json({ ok:true, result:{ message_id:1 } });
  };

  const result = await sendPhoto('222222:LOCAL_TEST_PUBLISH_TOKEN_123456789', '-1001', remote,
    'image/jpeg', '', [], null);
  assert.equal(result.message_id, 1);
  assert.equal(calls, 2);
});
