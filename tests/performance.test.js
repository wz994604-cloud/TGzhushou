import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageLoader } from '../src/image-loader.js';
import { createAssetCache } from '../server/asset-cache.js';

test('image loader coalesces requests, caps concurrency, evicts LRU and retries failures', async () => {
  let active = 0, peak = 0, calls = 0, fail = true;
  const load = createImageLoader(async key => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (key === 'fail' && fail) { fail = false; throw new Error('offline'); }
    return new Blob([key]);
  }, 2, 2);
  const a = load('a'); assert.equal(a, load('a'));
  await Promise.all([a, load('b'), load('c')]);
  assert.equal(peak, 2); assert.equal(calls, 3);
  await load('c'); assert.equal(calls, 3);
  await load('a'); assert.equal(calls, 4);
  await assert.rejects(load('fail'), /offline/);
  await load('fail'); assert.equal(calls, 6);
});

test('server cache deduplicates, expires, bounds entries and does not cache errors', async () => {
  const cached = createAssetCache({ limit:2, ttl:10 }); let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([cached('a', load), cached('a', load)]), [1, 1]);
  await cached('b', load); await cached('c', load); await cached('a', load);
  assert.equal(calls, 4);
  await new Promise(resolve => setTimeout(resolve, 15)); await cached('a', load);
  assert.equal(calls, 5);
  await assert.rejects(cached('bad', () => Promise.reject(new Error('retry'))));
  assert.equal(await cached('bad', load), 6);
});
