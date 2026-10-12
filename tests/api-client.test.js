import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/api-client.js';

test('API client uses the configured Serverless base', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = createApiClient({ baseUrl: 'https://app.example', initData: 'signed' });
    await client.api('/bootstrap');
    assert.equal(requests[0], 'https://app.example/bootstrap');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API client falls back to Railway when Serverless is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    if (requests.length === 1) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = createApiClient({ baseUrl: 'https://serverless.example', fallbackBaseUrl: 'https://railway.example' });
    await client.api('/bootstrap');
    assert.deepEqual(requests, ['https://serverless.example/bootstrap', 'https://railway.example/bootstrap']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Serverless endpoint base accepts a configured /api suffix', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = createApiClient({ mode: 'serverless', baseUrl: 'https://app.example/api', initData: 'signed' });
    await client.api('/bootstrap');
    assert.equal(requests[0].url, 'https://app.example/api/api');
    assert.equal(JSON.parse(requests[0].options.body).route, '/bootstrap');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const initData of ['', 'signed-telegram-fixture']) {
  test(`Railway workbench uses REST even with Telegram SDK: ${initData ? 'Mini App' : 'browser'}`, async () => {
    const originalFetch = globalThis.fetch;
    const originalTelegram = globalThis.Telegram;
    const originalConfig = globalThis.__TGZ_API_CONFIG__;
    const requests = [];
    let serverlessCalls = 0;
    globalThis.Telegram = { WebApp: { Serverless: { call() { serverlessCalls++; throw new Error('old backend must not be used'); } } } };
    globalThis.__TGZ_API_CONFIG__ = { serverlessBase: 'https://old.example' };
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ admin: { id: 'fixture' } }), { headers: { 'content-type': 'application/json' } });
    };
    try {
      const { createWorkbenchApiClient } = await import('../src/api-client.js');
      const client = createWorkbenchApiClient({ initData, getPublisherId: () => 'fixture-bot' });
      await client.api('/bootstrap');
      assert.equal(serverlessCalls, 0);
      assert.equal(requests[0].url, '/api/bootstrap');
      assert.equal(requests[0].options.method, 'GET');
      assert.equal(requests[0].options.headers['x-telegram-init-data'], initData);
      assert.equal(requests[0].options.headers['x-publisher-id'], 'fixture-bot');
      globalThis.fetch = async () => new Response(JSON.stringify({ error: '登录已过期，请重新打开小程序' }), { status: 401 });
      await assert.rejects(client.api('/bootstrap'), { status: 401, message: '登录已过期，请重新打开小程序' });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalTelegram === undefined) delete globalThis.Telegram; else globalThis.Telegram = originalTelegram;
      if (originalConfig === undefined) delete globalThis.__TGZ_API_CONFIG__; else globalThis.__TGZ_API_CONFIG__ = originalConfig;
    }
  });
}

test('Railway REST bootstrap accepts signed Mini App identity with the real verifier', async () => {
  const { createServer } = await import('node:http');
  const { verifyInitData } = await import('../server/auth.js');
  const { signedData, entryToken } = await import('./helpers.js');
  const { createWorkbenchApiClient } = await import('../src/api-client.js');
  const originalConfig = globalThis.__TGZ_API_CONFIG__;
  const paths = [];
  const server = createServer((req, res) => {
    paths.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    try {
      assert.equal(req.url, '/api/bootstrap');
      const admin = verifyInitData(req.headers['x-telegram-init-data'], entryToken, '123456');
      res.end(JSON.stringify({ admin }));
    } catch (error) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const railwayBase of [origin, `${origin}/api/`]) {
      globalThis.__TGZ_API_CONFIG__ = { railwayBase };
      const result = await createWorkbenchApiClient({ initData: signedData() }).api('/bootstrap');
      assert.equal(result.admin.id, '123456');
    }
    assert.deepEqual(paths, ['GET /api/bootstrap', 'GET /api/bootstrap']);
    await assert.rejects(createWorkbenchApiClient({ initData: signedData(123456, { auth_date: '1' }) }).api('/bootstrap'), { status: 401 });
  } finally {
    if (originalConfig === undefined) delete globalThis.__TGZ_API_CONFIG__; else globalThis.__TGZ_API_CONFIG__ = originalConfig;
    await new Promise(resolve => server.close(resolve));
  }
});
