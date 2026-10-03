import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { entryToken,configKey } from './helpers.js';
import './fake-telegram.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tgzhushou-browser-'));
Object.assign(process.env,{ENTRY_BOT_TOKEN:entryToken,CONFIG_KEY:configKey,ADMIN_TG_IDS:'123456',ADMIN_LOGIN_USERNAME:'admin',ADMIN_LOGIN_PASSWORD:'test-password-123',PORT:'8099',PUBLIC_URL:'https://test.local'});
process.on('exit',()=>{try{fs.rmSync(dir,{recursive:true,force:true});}catch{}});
await import('../server/index.js');


