import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbenchApiClient} from '../src/api-client.js';
import {accountFixture} from './account-auth-fixture.js';

test('all surfaces use Railway cookie sessions; SDK cannot select legacy Serverless',async()=>{
 const oldFetch=globalThis.fetch,oldTelegram=globalThis.Telegram,oldConfig=globalThis.__TGZ_API_CONFIG__;
 const requests=[];let unauthorized=0;
 globalThis.Telegram={WebApp:{initData:'unrelated-telegram',Serverless:{call(){throw new Error('obsolete backend');}}}};
 globalThis.__TGZ_API_CONFIG__={serverlessBase:'https://obsolete.example',fallbackBaseUrl:'https://obsolete.example'};
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json'}})};
 try {
   const client=createWorkbenchApiClient({getPublisherId:()=> '1001',onUnauthorized:()=>unauthorized++});
   await client.api('/bootstrap');
   assert.equal(requests[0].url,'/api/bootstrap');assert.equal(requests[0].options.credentials,'same-origin');
   assert.deepEqual(requests[0].options.headers,{'x-publisher-id':'1001'});
   const body=new FormData();body.append('file',new Blob(['fixture']),'fixture.txt');
   await client.api('/media','POST',body);assert.equal(requests[1].options.body,body);
   assert.equal(requests[1].options.headers['content-type'],undefined);
   await client.api('/tasks','POST',{title:'fixture'});assert.equal(requests[2].options.body,'{"title":"fixture"}');
   globalThis.fetch=async()=>new Response(JSON.stringify({error:'没有权限'}),{status:403});
   await assert.rejects(client.api('/bootstrap'),{status:403});assert.equal(unauthorized,0);
   globalThis.fetch=async()=>new Response(JSON.stringify({error:'请登录账号'}),{status:401});
   await assert.rejects(client.api('/bootstrap'),{status:401});assert.equal(unauthorized,1);
   await assert.rejects(client.image('/media/1'),{status:401});assert.equal(unauthorized,2);
 }finally {
   globalThis.fetch=oldFetch;
   if(oldTelegram===undefined)delete globalThis.Telegram;else globalThis.Telegram=oldTelegram;
   if(oldConfig===undefined)delete globalThis.__TGZ_API_CONFIG__;else globalThis.__TGZ_API_CONFIG__=oldConfig;
 }
});
test('real HTTP login, cookie-authenticated bootstrap, and logout share one account path',async()=>{
 const f=await accountFixture(),oldFetch=globalThis.fetch,oldConfig=globalThis.__TGZ_API_CONFIG__;
 try {
   const cookie=await f.login('operator','operator-fixture-password');
   // Node fetch has no browser cookie jar: forward only this local fixture's session cookie.
   globalThis.fetch=(url,options)=>oldFetch(url,{...options,headers:{...options.headers,cookie}});
   for(const railwayBase of [f.base,`${f.base}/api/`]) {
     globalThis.__TGZ_API_CONFIG__={railwayBase};
     const client=createWorkbenchApiClient();
     const result=await client.api('/bootstrap');assert.equal(result.admin.username,'operator');
   }
   const client=createWorkbenchApiClient();
   await f.request('/auth/logout',{method:'POST',headers:{cookie}});
   await assert.rejects(client.api('/bootstrap'),{status:401});
 }finally {
   globalThis.fetch=oldFetch;
   if(oldConfig===undefined)delete globalThis.__TGZ_API_CONFIG__;else globalThis.__TGZ_API_CONFIG__=oldConfig;
   await f.close();
 }
});
