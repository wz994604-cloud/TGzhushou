import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(process.env.SOURCE_FILE || 'server/index.js','utf8');
const start=source.indexOf("app.get('/api/sticker-packs/saved', route(async (req, res) => {");
const body=source.slice(source.indexOf('{',start)+1,source.indexOf('\n}));',start));
const handler=new (Object.getPrototypeOf(async function(){}).constructor)('req','res','currentBot','db',body);
for(const count of [0,2]) test('saved packs serialize resolved sticker arrays: '+count,async()=>{
 let result;const packs=Array.from({length:count},(_,i)=>({id:i+1,title:'Pack '+i}));
 const db={prepare:sql=>({all:async id=>{await new Promise(r=>setTimeout(r,5));return sql.includes('FROM sticker_packs ')?packs:[{id:String(id),alt:'🙂'}];}})};
 await handler({}, {json:value=>{result=JSON.parse(JSON.stringify(value));}},()=>({id:'123'}),db);
 assert.equal(result.packs.length,count);
 for(const pack of result.packs){assert.ok(Array.isArray(pack.stickers),'stickers must be a resolved array');assert.equal(pack.stickers.length,1);assert.equal(pack.stickers[0].id,String(pack.id));}
});
