import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultButtonRow,normalizeButtonRows,reflowAutomaticButtonRows,emojiPopoverPosition,emojiMatches} from '../src/workbench-utils.js';
test('new automatic buttons use paired rows and delete reflows by actual index',()=>{
 const buttons=Array.from({length:6},(_,i)=>({row:defaultButtonRow(i),rowExplicit:false}));
 assert.deepEqual(buttons.map(b=>b.row),[0,0,1,1,2,2]);buttons.splice(1,1);reflowAutomaticButtonRows(buttons);
 assert.deepEqual(buttons.map(b=>b.row),[0,0,1,1,2]);
});
test('manual rows survive deletion, including a manually chosen default row',()=>{
 const buttons=[{row:0,rowExplicit:false},{row:0,rowExplicit:true},{row:7,rowExplicit:true},{row:1,rowExplicit:false}];
 buttons.shift();normalizeButtonRows(buttons);reflowAutomaticButtonRows(buttons);
 assert.deepEqual(buttons.map(b=>b.row),[0,7,1]);
});
test('stored server rows lacking metadata are preserved, not guessed automatic',()=>{
 const buttons=[{row:1},{row:1},{row:4}];normalizeButtonRows(buttons);buttons.shift();reflowAutomaticButtonRows(buttons);
 assert.deepEqual(buttons.map(b=>b.row),[1,4]);
});
test('missing and invalid row values get two-column defaults',()=>{
 const buttons=[{}, {row:-1}, {row:'2'},{}];normalizeButtonRows(buttons);assert.deepEqual(buttons.map(b=>b.row),[0,0,1,1]);
});
test('emoji popup chooses upwards and clamps inside the viewport',()=>{
 const p=emojiPopoverPosition({left:1320,top:780,bottom:824},{width:1440,height:900});
 assert.equal(p.upward,true);assert.equal(p.left,1028);assert.equal(p.top,412);
 assert.ok(p.left+p.width<=1428);assert.ok(p.top+p.height<=888);
});
test('emoji popup falls below top anchors and remains inside short viewports',()=>{
 const p=emojiPopoverPosition({left:4,top:40,bottom:84},{width:320,height:300});
 assert.equal(p.upward,false);assert.equal(p.left,12);assert.ok(p.top+p.height<=288);
});
test('emoji search covers true custom emoji IDs and alternatives only',()=>{
 assert.equal(emojiMatches({id:'12345678',alt:'🔥'},'1234'),true);
 assert.equal(emojiMatches({id:'12345678',alt:'🔥'},'🔥'),true);
 assert.equal(emojiMatches({id:'12345678',alt:'🔥'},'💎'),false);
});
