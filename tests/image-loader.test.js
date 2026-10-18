import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageLoader } from '../src/image-loader.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

test('clearing cache isolates old completion from a new request for the same image', async () => {
  const requests = [];
  const load = createImageLoader(() => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  });
  const old = load('image');
  await flush();
  load.clear();
  const current = load('image');
  await flush();
  requests[0].resolve('old');
  await old;
  await flush();
  assert.equal(load('image'), current);
  requests[1].resolve('current');
  assert.equal(await current, 'current');
  await flush();
  assert.equal(await load('image'), 'current');
  assert.equal(requests.length, 2);
});

test('image requests share pending work and respect concurrency', async () => {
  const requests = [];
  const load = createImageLoader(key => {
    const request = deferred();
    requests.push({ key, ...request });
    return request.promise;
  }, 2, 1);
  const first = load('first');
  assert.equal(load('first'), first);
  const second = load('second');
  await flush();
  assert.deepEqual(requests.map(r => r.key), ['first']);
  requests[0].resolve('one');
  await first;
  await flush();
  assert.deepEqual(requests.map(r => r.key), ['first', 'second']);
  requests[1].resolve('two');
  assert.equal(await second, 'two');
});
