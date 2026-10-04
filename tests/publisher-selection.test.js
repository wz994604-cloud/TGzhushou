import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(process.env.PUBLISHER_SELECTION_SOURCE || new URL('../server/index.js', import.meta.url), 'utf8');
const start = source.indexOf("app.use('/api',");
const end = source.indexOf('const route =', start);
assert.ok(start > 0 && end > start);
function request(path, method = 'GET', authenticated = true, selected = 'old-bot') {
  let handler, status, error, next = false;
  vm.runInNewContext(source.slice(start,end), {
    app: { use: (_path, fn) => { handler = fn; } },
    browserAuth: { authenticate: () => authenticated ? { id:'admin' } : null },
    scheduler: { publisher: id => id === 'valid-bot' ? { id } : null }
  });
  const req = { path, method, headers: { 'x-publisher-id':selected }, get(key) { return this.headers[key]; } };
  handler(req, { status(code) { status = code; return this; }, json(body) { error = body.error; } }, () => { next = true; });
  return { req, status, error, next };
}
test('authenticated bootstrap recovers a stale selection without bypassing other routes', () => {
  const recovered = request('/bootstrap');
  assert.equal(recovered.next, true);
  assert.equal(recovered.req.get('x-publisher-id'), undefined);
  assert.equal(request('/bootstrap','GET',false).status, 401);
  assert.equal(request('/publisher','POST').status, 401);
  assert.equal(request('/players').status, 401);
  const valid = request('/bootstrap','GET',true,'valid-bot');
  assert.equal(valid.next, true);
  assert.equal(valid.req.get('x-publisher-id'), 'valid-bot');
});
test('refresh clears stale browser selection and preserves a valid selection', () => {
  const frontend = fs.readFileSync(new URL('../src/main.js', import.meta.url),'utf8');
  const start = frontend.indexOf('data=result;selectedPublisherId=');
  const end = frontend.indexOf("$('identity')",start);
  assert.ok(start > 0 && end > start);
  for (const id of ['', 'valid-bot']) {
    const storage = new Map([['tgzhushou:selected-publisher','old-bot']]);
    const context = { result: { publisher:id ? { id } : null }, selectedPublisherId:'old-bot',
      localStorage: { setItem:(key,value)=>storage.set(key,value), removeItem:key=>storage.delete(key) } };
    vm.runInNewContext(frontend.slice(start,end),context);
    assert.equal(context.selectedPublisherId,id);
    assert.equal(storage.get('tgzhushou:selected-publisher'),id || undefined);
  }
});
