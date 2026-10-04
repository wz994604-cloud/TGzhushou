// Isolated test server: local database and synthetic upstreams only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {entryToken, configKey} from './helpers.js';
import './fake-telegram.js';
const dir = process.env.TEST_DATABASE_FILE ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'tgzhushou-player-api-'));
Object.assign(process.env, {
  NODE_ENV:'test', TEST_DATABASE_FILE:process.env.TEST_DATABASE_FILE || path.join(dir, 'test.db'),
  ENTRY_BOT_TOKEN:entryToken, CONFIG_KEY:configKey, ADMIN_TG_IDS:'123456,999999',
  ADMIN_LOGIN_ACCOUNTS:JSON.stringify([
    {username:'wz994604', password:'test-owner-password'},
    {username:'operator', password:'test-operator-password', publisherIds:['333333']},
    {username:'existing-admin', password:'test-existing-password'}
  ]), PUBLIC_URL:'', VERCEL:'1', FFA_API_BASE_URL:'https://player-source.test.invalid'
});
const upstream = globalThis.fetch, transport = [];
globalThis.fetch = async (url, options={}) => {
  const address = String(url);
  if (address.startsWith('https://player-source.test.invalid/')) {
    if (new URL(address).pathname !== '/Admin/user/list') throw Error('Unexpected source path');
    const token = options.headers?.authorization;
    const label = token === 'SYNTHETIC_SOURCE_A_1234567890' ? 'A' : token === 'SYNTHETIC_SOURCE_B_1234567890' ? 'B' : '';
    if (!label) return Response.json({status:false}, {status:401});
    transport.push({kind:'source', label, page:new URLSearchParams(options.body).get('page_index')});
    return Response.json({status:true, count:2, data:[
      {id:1, uid:'80001', nickname:label+' common', tgusername:label+'_common', status:1},
      {id:2, uid:label==='A'?'81001':'83001', nickname:label+' only', status:1}
    ]});
  }
  if (address.startsWith('https://api.telegram.org/')) {
    const match = address.match(/\/bot(111111|222222|333333):/);
    if (!match && !address.includes('/file/bot')) throw Error('Unexpected synthetic bot');
    const method = address.split('/').at(-1);
    if (method.startsWith('send')) transport.push({kind:'telegram', botId:match?.[1], method, chatId:JSON.parse(options.body).chat_id});
    return upstream(url, options);
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(address)) throw Error('Test blocked external network');
  return upstream(url, options);
};
const {default:app} = await import('../server/index.js');
app.get('/__test/transport', (_req,res)=>res.json(transport));
const server = app.listen(Number(process.env.TEST_SERVER_PORT ?? 8101), '127.0.0.1', ()=>console.log('TEST_READY '+JSON.stringify({port:server.address().port})));
process.on('SIGTERM', ()=>server.close(()=>process.exit(0)));
