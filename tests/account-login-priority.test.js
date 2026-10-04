import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(process.env.SOURCE_FILE||'server/index.js','utf8');const start=source.indexOf('req.admin = ',source.indexOf("app.use('/api'"));const expr=source.slice(start+12,source.indexOf(';',start));
const resolve=new (Object.getPrototypeOf(async function(){}).constructor)('req','browserAuth','verifyInitData','adminIds','return '+expr);
test('password session wins even with another Telegram identity',async()=>{const account={username:'operator',publisherIds:['123']};assert.deepEqual(await resolve({get:()=> 'other-telegram-user'},{authenticate:async()=>account},()=>{throw Error('Telegram ID denied')},['999']),account);});
test('no valid session does not receive account privileges',async()=>{assert.equal(await resolve({get:()=> ''},{authenticate:async()=>null},()=>{throw Error('must not verify empty data')},[]),null);});
