import test from 'node:test';
import assert from 'node:assert/strict';
import { deletionRange } from '../src/editor-delete.js';

test('backspace covers ordinary text, newline, graphemes, and custom embeds', () => {
  for (const value of ['字', 'A', '\n', '😀', '🇨🇳', '👨‍👩‍👧‍👦', '👍🏽', 'e\u0301']) {
    assert.deepEqual(deletionRange([{insert:'前'+value+'\n'}], {index:1+value.length,length:0}), {index:1,length:value.length});
  }
  assert.deepEqual(deletionRange([{insert:'前'},{insert:{customEmoji:{id:'12345'}}},{insert:'\n'}], {index:2,length:0}), {index:1,length:1});
  assert.deepEqual(deletionRange([{insert:'abc\n'}], {index:0,length:0}), {index:0,length:0});
});

test('selections and split formatting runs keep whole characters and terminal newline', () => {
  const ops = [{insert:'前\ud83d',attributes:{bold:true}},{insert:'\ude00后\n'}];
  assert.deepEqual(deletionRange(ops,{index:2,length:0}),{index:1,length:2});
  assert.deepEqual(deletionRange(ops,{index:2,length:1}),{index:1,length:2});
  assert.deepEqual(deletionRange(ops,{index:0,length:99}),{index:0,length:4});
  assert.deepEqual(deletionRange([{insert:'\n'}],{index:0,length:99}),{index:0,length:0});
});
