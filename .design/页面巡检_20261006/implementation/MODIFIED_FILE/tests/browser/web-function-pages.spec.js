import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const phase=process.env.UI_PHASE||'modified';
const shots='.design/function-pages-20261006/'+phase;fs.mkdirSync(shots,{recursive:true});
const now=Date.UTC(2026,9,4,4),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/C9sAAAAASUVORK5CYII=','base64');
// Explicitly isolated UI fixtures: no production accounts, webhooks or Telegram sends.
async function setup(page,{mini=false,empty=false,manage=false}={}){
 const calls=[],errors=[];let ready=false,packs=[],id=10;
 const conversations=empty?[]:[{chat_id:'80001',title:'测试联系人甲',unread_count:1,last_message_text:'这是一条测试消息',last_message_at:now},{chat_id:'80002',title:'测试联系人乙',unread_count:0,last_message_text:'谢谢',last_message_at:now-3600000}];
 const tasks=empty?[]:[{id:1,name:'手动草稿（测试）',status:'DRAFT',schedule_json:'{"kind":"MANUAL"}',next_at:null}];
 const target={id:1,title:'测试频道',chat_id:'-1001',can_publish:1};
 const messages=Array.from({length:50},(_,i)=>({id:i+1,telegram_message_id:i+1,direction:i%2?'OUT':'IN',status:'SUCCESS',text:'用于滚动和时间验证的合成测试消息 '+i,sent_at:now-(i<25?86400000:0)+i*1000}));
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://telegram.org/js/telegram-web-app.js',r=>r.fulfill({contentType:'application/javascript',body:mini?'window.Telegram={WebApp:{initData:"synthetic-ui-fixture",ready(){},expand(){}}};':''}));
 await page.route('**/api/**',async r=>{
   const req=r.request(),u=new URL(req.url()),path=u.pathname.slice(4),body=req.postDataJSON?.bind(req);let result;
   calls.push({path,method:req.method(),body:req.postData()});
   if(path.includes('avatars')||path.startsWith('/sticker-image')||/^\/media\/\d+$/.test(path))return r.fulfill({contentType:'image/png',body:png});
   if(path==='/bootstrap')result={admin:{id:'123456',name:'测试管理员',canManageBots:manage},publisher:{id:req.headers()['x-publisher-id']||'222222',username:'test_publisher',legacy:true},publishers:[{id:'222222',username:'test_publisher'},{id:'333333',username:'test_second'}],targets:empty?[]:[target,{id:2,title:'无发布权限目标',chat_id:'-1002',can_publish:0,last_error:'机器人不是管理员'}],tasks};
   else if(path==='/admin/accounts')result={canManage:manage,accounts:[]};
   else if(path==='/ffa')result={configured:false,baseUrl:'https://example.invalid'};
   else if(path==='/inbox/status')result={status:ready?'READY':'EXTERNAL'};
   else if(path==='/inbox/enable'){ready=true;result={ok:true};}
   else if(path==='/chat/conversations')result={rows:conversations.filter(c=>!u.searchParams.get('q')||c.chat_id.includes(u.searchParams.get('q'))||c.title.includes(u.searchParams.get('q'))),next:null,cursor:50,totalUnread:1};
   else if(path.endsWith('/messages'))result={rows:messages,next:null};
   else if(path.endsWith('/read'))result={ok:true};
   else if(path==='/chat/updates')result={rows:[],cursor:50};
   else if(path.endsWith('/send')&&path.startsWith('/chat/'))result={ok:true};
   else if(path==='/players')result={rows:empty?[]:[{telegram_id:'80001',display_name:'测试联系人甲',username:'test_a',active:1,last_seen:now},{telegram_id:'80002',display_name:'测试联系人乙',username:'test_b',active:0,last_seen:now}],total:empty?0:2};
   else if(path==='/players/ids')result={rows:[{telegram_id:'80001',display_name:'测试联系人甲'}]};
   else if(path==='/broadcasts')result=empty?[]:[{id:2,name:'用户发布测试',status:'FAILED',success_count:1,failed_count:1,pending_count:0,created_at:now}];
   else if(path==='/runs')result=empty?[]:[{id:1,name:'频道发布测试',created_at:now,success_count:1,failed_count:1,unknown_count:0,total:2}];
   else if(path==='/runs/1')result={id:1,deliveries:[{id:1,chat_id:'-1002',title:'测试目标',status:'FAILED',error_text:'测试：机器人缺少权限'}]};
   else if(path==='/sticker-packs/saved'&&req.method()==='GET')result={packs};
   else if(path==='/sticker-packs/saved'){packs=[body()];result={ok:true};}
   else if(path==='/sticker-packs'){
      if(body().pack.includes('bad'))return r.fulfill({status:400,json:{error:'测试：表情包链接无效'}});
      result={name:'test_pack',title:'合成专属表情包',stickers:[{id:'5432101234567890123',alt:'🔥'},{id:'5432101234567890124',alt:'💎'}]};
   }
   else if(path==='/chat/media')result={id:id++,mime:req.postData()?.includes('video/mp4')?'video/mp4':req.postData()?.includes('text/plain')?'text/plain':'image/png',size:123};
   else if((path==='/tasks'&&req.method()==='POST')||(path==='/tasks/9'&&req.method()==='PUT')){const payload=body();result={id:9,...payload};tasks.push({id:9,name:payload.name,status:'DRAFT',schedule_json:JSON.stringify(payload.schedule)});}
   else if(path==='/tasks/9/send')result={runId:10};
   else return r.fulfill({status:404,json:{error:'UNEXPECTED UI FIXTURE REQUEST '+path}});
   return r.fulfill({json:result});
 });
 await page.goto('/');await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#publisherSelect')).toBeVisible();
 return {calls,errors};
}

const pages=[
  ['编写活动','editor'],['素材管理','assets'],['联系人 / 用户','players'],
  ['自动化任务','tasks'],['发布记录','logs'],['系统设置','settings']
];

test('web function pages keep real structure and the liquid glass treatment',async({page})=>{
  const fixture=await setup(page);
  for(const [label,id] of pages){
    await page.getByRole('button',{name:label,exact:true}).click();
    await expect(page.locator('#'+id)).toBeVisible();
    await page.screenshot({path:`${shots}/${id}.png`,fullPage:false});
  }
  const brand=await page.locator('.rail-brand-mark').evaluate(el=>{
    const style=getComputedStyle(el);return {background:style.backgroundColor,color:style.color,border:style.borderTopColor,shadow:style.boxShadow};
  });
  const type=await page.locator('#settings h2').evaluate(el=>{
    const style=getComputedStyle(el);return {family:style.fontFamily,size:style.fontSize,weight:style.fontWeight,line:style.lineHeight};
  });
  expect(brand.color).toBe('rgb(247, 251, 255)');
  expect(brand.shadow).toBe('none');
  expect(type.family).toContain('思源黑体');
  expect(type.size).toBe('20px');
  expect(type.weight).toBe('600');
  expect(fixture.errors).toEqual([]);
});

test('web function pages render truthful empty states without page errors',async({page})=>{
  const fixture=await setup(page,{empty:true});
  for(const [label,id] of pages){
    await page.getByRole('button',{name:label,exact:true}).click();
    await expect(page.locator('#'+id)).toBeVisible();
    await page.screenshot({path:`${shots}/${id}-empty.png`,fullPage:false});
  }
  expect(fixture.errors).toEqual([]);
});
test('final UX: published result opens read-only before explicit management',async({page})=>{
  const {calls,errors}=await setup(page);
  await page.getByRole('button',{name:'发布记录',exact:true}).click();
  await page.locator('[data-run="1"] summary').click();
  await expect(page.locator('[data-run="1"] [data-expand-label]')).toHaveText('收起详情');
  await page.locator('[data-run-detail="1"]').click();
  await expect(page.locator('#sentDialog')).toBeVisible();
  await expect(page.locator('#sentDialog h3')).toHaveText('发布结果');
  await expect(page.locator('#sentManagePanel')).toBeHidden();
  await expect(page.locator('#sentRecipients')).toContainText('机器人缺少权限');
  await page.locator('#enterSentManage').click();
  await expect(page.locator('#sentManagePanel')).toBeVisible();
  await page.locator('#backSentResults').click();
  await expect(page.locator('#sentManagePanel')).toBeHidden();
  await page.locator('#closeSent').click();
  expect(calls.filter(c=>c.method!=='GET')).toEqual([]);
  expect(errors).toEqual([]);
});
test('final UX: asset intent returns to its editor without changing draft text',async({page})=>{
  const {calls,errors}=await setup(page);
  await page.getByRole('button',{name:'素材管理',exact:true}).click();
  await page.locator('#assetUpload').setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')});
  await expect(page.locator('[data-asset-use="10"]')).toBeVisible();
  await page.getByRole('button',{name:'编写活动',exact:true}).click();
  await page.locator('#toggleWriting').click();
  await page.locator('#message .ql-editor').fill('保留正文');
  await page.getByRole('button',{name:'从素材选择',exact:true}).click();
  await expect(page.locator('#assetIntentText')).toContainText('当前活动');
  await page.locator('[data-asset-use="10"]').click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#message .ql-editor')).toHaveText('保留正文');
  await expect(page.locator('#photoMeta')).toContainText('fixture.txt');
  await page.getByRole('button',{name:'从素材选择',exact:true}).click();
  await page.locator('#cancelAssetIntent').click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#message .ql-editor')).toHaveText('保留正文');
  expect(calls.filter(c=>c.method!=='GET').map(c=>c.path)).toEqual(['/chat/media']);
  expect(errors).toEqual([]);
});
test('final UX: chat asset intent restores the active conversation and draft',async({page})=>{
  const {calls,errors}=await setup(page);
  await page.getByRole('button',{name:'素材管理',exact:true}).click();
  await page.locator('#assetUpload').setInputFiles({name:'chat-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')});
  await expect(page.locator('[data-asset-chat="10"]')).toBeDisabled();
  await page.getByRole('button',{name:'聊天',exact:true}).click();
  await page.locator('[data-chat-id="80001"]').click();
  await page.locator('#chatInput .ql-editor').fill('会话草稿');
  await page.locator('#chatToolsMore').click();
  await page.locator('#chatAsset').click();
  await expect(page.locator('#assetIntentText')).toContainText('当前会话');
  await page.locator('[data-asset-chat="10"]').click();
  await expect(page.locator('#chat')).toBeVisible();
  await expect(page.locator('#chatInput .ql-editor')).toHaveText('会话草稿');
  await expect(page.locator('#chatMedia')).toContainText('chat-fixture.txt');
  expect(calls.filter(c=>c.method!=='GET').map(c=>c.path)).toEqual(['/chat/media','/chat/conversations/80001/read']);
  expect(errors).toEqual([]);
});
