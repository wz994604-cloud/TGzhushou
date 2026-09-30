import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyInitData } from '../server/auth.js';
import { signedData, entryToken } from './helpers.js';

test('valid Mini App HMAC includes signature field and accepts bound account', () => {
  assert.equal(verifyInitData(signedData(), entryToken, '123456').id, '123456');
  assert.equal(verifyInitData(signedData(999999), entryToken, '123456,999999').id, '999999');
});
test('rejects tampering, a different account, expired auth and duplicate fields', () => {
  const raw = signedData();
  assert.throws(()=>verifyInitData(raw.replace('123456','999999'),entryToken,'123456'));
  assert.throws(()=>verifyInitData(signedData(999999),entryToken,'123456'));
  assert.throws(()=>verifyInitData(signedData(123456,{auth_date:'1'}),entryToken,'123456'));
  assert.throws(()=>verifyInitData(`${raw}&user=anything`,entryToken,'123456'));
  assert.throws(()=>verifyInitData(raw, 'different-token', '123456'));
});
