import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';import vm from 'node:vm';
const base='.design/web-ui-refinement/';
for(const name of ['main.js','workbench-shell.js','glass-theme-final.css']){
 const original=fs.readFileSync(base+'baseline-'+name), restored=fs.readFileSync(base+'rollback-test/'+name);
 assert.equal(crypto.createHash('sha256').update(restored).digest('hex'),crypto.createHash('sha256').update(original).digest('hex'));
 assert.notDeepEqual(fs.readFileSync('src/'+name),restored);
}
const source=fs.readFileSync(base+'rollback-test/main.js','utf8');
const a=source.indexOf('data=result;selectedPublisherId='),b=source.indexOf("$('identity')",a);
for(const id of ['', 'valid-bot']){
 const storage=new Map();const context={result:{publisher:id?{id}:null},selectedPublisherId:'old-bot',localStorage:{setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
 vm.runInNewContext(source.slice(a,b),context);assert.equal(context.selectedPublisherId,id);
}
assert.ok(fs.readFileSync(base+'rollback-test/workbench-shell.js','utf8').includes('top.append(toggle,search,publisher,topActions,account)'));
assert.ok(fs.readFileSync(base+'rollback-test/glass-theme-final.css','utf8').includes('min-height:39px!important'));
console.log('ROLLBACK PASS: 3 hashes match; original selector and navigation restored; source changes retained');
