import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTelegramId, parseCsv } from '../server/player-utils.js';

test('normalizes WPS numeric and scientific Telegram IDs without losing text IDs', () => {
  assert.equal(normalizeTelegramId('8547433574'), '8547433574');
  assert.equal(normalizeTelegramId('1.791E+09'), '1791000000');
  assert.equal(normalizeTelegramId('"9876543210"'), '9876543210');
  assert.equal(normalizeTelegramId('not-an-id'), '');
});

test('parses WPS CSV BOM, quoted commas and CRLF rows', () => {
  const rows = parseCsv('\ufeffID,昵称,用户名\r\n1449,"涵涵,非常好",8547433574\r\n1450,李四,1.791E+09\r\n');
  assert.deepEqual(rows, [['ID','昵称','用户名'],['1449','涵涵,非常好','8547433574'],['1450','李四','1.791E+09']]);
});
