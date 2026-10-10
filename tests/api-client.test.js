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
