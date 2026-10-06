import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const phase=process.env.UI_PHASE || 'modified';
const shots='.design/web-ui-refinement/'+phase;fs.mkdirSync(shots,{recursive:true});
const now=Date.UTC(2026,9,4,4),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/C9sAAAAASUVORK5CYII=','base64');
// Explicitly isolated UI fixtures: no production accounts, webhooks or Telegram sends.
async function setup(page,{mini=false,empty=false}={}){
 const calls=[],errors=[];let ready=false,packs=[],id=10;
 const conversations=empty?[]:[{chat_id:'80001',title:'测试联系人甲',unread_count:1,last_message_text:'这是一条测试消息',last_message_at:now},{chat_id:'80002',title:'测试联系人乙',unread_count:0,last_message_text:'谢谢',last_message_at:now-3600000}];
 const tasks=[{id:1,name:'手动草稿（测试）',status:'DRAFT',schedule_json:'{"kind":"MANUAL"}',next_at:null}];
 const target={id:1,title:'测试频道',chat_id:'-1001',can_publish:1};
 const messages=Array.from({length:50},(_,i)=>({id:i+1,telegram_message_id:i+1,direction:i%2?'OUT':'IN',status:'SUCCESS',text:'用于滚动和时间验证的合成测试消息 '+i,sent_at:now-(i<25?86400000:0)+i*1000}));
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://telegram.org/js/telegram-web-app.js',r=>r.fulfill({contentType:'application/javascript',body:mini?'window.Telegram={WebApp:{initData:"synthetic-ui-fixture",ready(){},expand(){}}};':''}));
 await page.route('**/api/**',async r=>{
   const req=r.request(),u=new URL(req.url()),path=u.pathname.slice(4),body=req.postDataJSON?.bind(req);let result;
   calls.push({path,method:req.method(),body:req.postData(),publisher:req.headers()['x-publisher-id']});
   if(path.includes('avatars')||path.startsWith('/sticker-image')||/^\/media\/\d+$/.test(path))return r.fulfill({contentType:'image/png',body:png});
   if(path==='/bootstrap')result={admin:{id:'123456',name:'测试管理员'},publisher:{id:req.headers()['x-publisher-id']||'222222',username:'test_publisher',legacy:true},publishers:[{id:'222222',username:'test_publisher'},{id:'333333',username:'test_second'}],targets:[target,{id:2,title:'无发布权限目标',chat_id:'-1002',can_publish:0,last_error:'机器人不是管理员'}],tasks};
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
 await page.goto('/');await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('[data-chat-id="80001"]')).toBeVisible();
 return {calls,errors};
}
test('chat refinement: same geometry, clear material and complete scoped publisher selection', async({page})=>{
 const {calls,errors}=await setup(page);
 await expect(page.locator('#publisherSelect option')).toHaveCount(2);
 if(phase!=='baseline')await expect(page.locator('[data-details-send]')).toBeDisabled();
 await page.screenshot({path:shots+'/empty.png'});
 await page.locator('[data-chat-id="80001"]').click();
 await expect(page.locator('.chat-bubble')).toHaveCount(50);
 await page.screenshot({path:shots+'/selected.png'});
 const styles=await page.evaluate(()=>({styles:[...document.styleSheets].map(s=>s.href||'inline'),computed:['.desktop-shell','.chat-shell','.app-rail','.rail-bot','.rail-nav button','.desktop-topbar','.chat-list'].map(q=>{const s=getComputedStyle(document.querySelector(q));return {selector:q,background:s.background,columns:s.gridTemplateColumns,font:s.fontSize,height:s.height};})}));
 fs.writeFileSync(shots+'/computed.json',JSON.stringify(styles,null,2));
 if(phase==='baseline') {expect(errors).toEqual([]);return;}
 await expect(page.locator('#railBots #publisherSelect')).toHaveCount(1);
 await expect(page.locator('.desktop-topbar #publisherSelect')).toHaveCount(0);
 await expect(page.locator('[data-rail-tab="chat"]')).toHaveCSS('font-size','15px');
 await expect(page.locator('[data-rail-tab="chat"]')).toHaveCSS('height','54px');
 await expect(page.locator('[data-rail-tab="chat"] svg')).toHaveCSS('width','22px');
 await expect(page.locator('[data-rail-tab="chat"] svg')).toHaveCSS('color','rgb(20, 95, 168)');
 await expect(page.locator('#chatSend')).toHaveCSS('color','rgb(255, 255, 255)');
 await expect(page.locator('.details-status')).toHaveCSS('color','rgb(95, 107, 122)');
 await expect(page.locator('.details-actions button:disabled')).toHaveCount(3);
 let release;const held=new Promise(resolve=>release=resolve);
 await page.route('**/api/bootstrap',async r=>{await held;await r.fallback();});
 await page.locator('#publisherSelect').selectOption('333333');
 await expect(page.locator('#publisherSelect')).toBeDisabled();
 release();
 await expect(page.locator('#publisherSelect')).toHaveValue('333333');
 await expect(page.locator('#chatComposer')).toBeHidden();
 await expect(page.locator('[data-details-send]')).toBeDisabled();
 expect(calls.some(c=>c.path==='/bootstrap')).toBe(true);
 await expect(page.locator('.rail-bot-name')).toHaveText('@test_second');
 await expect(page.locator('#publisherSelect')).toBeEnabled();
 await page.unroute('**/api/bootstrap');
 await expect.poll(()=>calls.some(c=>c.path==='/chat/conversations'&&c.publisher==='333333')).toBe(true);
 await page.locator('#publisherSelect').selectOption('222222');
 await expect(page.locator('#publisherSelect')).toHaveValue('222222');
 await expect(page.locator('#publisherSelect')).toBeEnabled();
 await page.route('**/api/bootstrap',r=>r.fulfill({status:500,json:{error:'测试切换失败'}}));
 await page.locator('#publisherSelect').selectOption('333333');
 await expect(page.locator('#toast')).toContainText('测试切换失败');
 await expect(page.locator('#publisherSelect')).toHaveValue('222222');
 await expect(page.locator('#publisherSelect')).toBeEnabled();
 expect(await page.evaluate(()=>localStorage.getItem('tgzhushou:selected-publisher'))).toBe('222222');
 await page.unroute('**/api/bootstrap');
 await page.route('**/api/bootstrap',r=>r.request().headers()['x-publisher-id']==='333333'?r.fulfill({status:403,json:{error:'测试：无机器人权限'}}):r.fallback());
 await page.locator('#publisherSelect').selectOption('333333');
 await expect(page.locator('#publisherSelect')).toHaveValue('222222');
 await expect(page.locator('#publisherSelect')).toBeEnabled();
 await expect(page.locator('#toast')).toContainText('已切换到 @test_publisher');
 await page.unroute('**/api/bootstrap');
 await page.locator('#publisherSelect').focus();
 await page.locator('#publisherSelect').press('Escape');
 await expect(page.locator('#publisherSelect')).toBeFocused();
 for(const size of [{width:1536,height:600},{width:1229,height:720},{width:1024,height:600},{width:390,height:844}]){
   await page.setViewportSize(size);
   if(size.width<900)await page.getByRole('button',{name:'打开导航'}).click();
   await page.locator('[data-rail-tab="settings"]').scrollIntoViewIfNeeded();
   await expect(page.locator('[data-rail-tab="settings"]')).toBeInViewport();
   await expect(page.locator('.rail-account')).toBeInViewport();
   await expect(page.locator('#publisherSelect')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:shots+`/responsive-${size.width}-${size.height}.png`});
 }
 expect(errors).toEqual([]);
});
test('Mini selector remains in its own topbar',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const {errors}=await setup(page,{mini:true});
 await expect(page.locator('.mini-topbar #publisherSelect')).toHaveCount(1);
 await expect(page.locator('.app-rail')).toHaveCount(0);
 await expect(page.locator('#publisherSelect option')).toHaveCount(2);
 expect(errors).toEqual([]);
});
test('final UX: narrow chat keeps list and composer usable, search and details are reversible',async({page})=>{
 await page.setViewportSize({width:892,height:668});
 const {calls,errors}=await setup(page);
 await page.locator('[data-chat-id="80001"]').click();
 await expect(page.locator('#chat .chat-list')).toBeVisible();
 await expect(page.locator('#chat .chat-main')).toBeVisible();
 await expect(page.locator('#chatComposer')).toHaveClass(/compact-composer/);
 await page.locator('#chatInput .ql-editor').fill('待保留的草稿');
 await page.locator('[data-reply="50"]').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#chatReply')).toBeVisible();
 await page.locator('#cancelChatReply').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#chatReply')).toBeHidden();
 await expect(page.locator('#chatInput .ql-editor')).toHaveText('待保留的草稿');
 await page.locator('#showChatDetails').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('.desktop-shell')).toHaveClass(/details-open/);
 await page.keyboard.press('Escape');
 await expect(page.locator('.desktop-shell')).not.toHaveClass(/details-open/);
 await expect(page.locator('#showChatDetails')).toBeFocused();
 await expect(page.locator('#chatInput .ql-editor')).toHaveText('待保留的草稿');
 await page.locator('#chatSearch').fill('找不到的联系人');
 await expect(page.locator('#chatConversations')).toContainText('未找到匹配会话');
 await page.locator('[data-search-action="clear"]').click();
 await expect(page.locator('[data-chat-id="80001"]')).toBeVisible();
 await page.screenshot({path:shots+'/narrow-892.png'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 for(const size of [{width:1100,height:700},{width:1440,height:900}]){
   await page.setViewportSize(size);
   await expect(page.locator('#chatInput .ql-editor')).toHaveText('待保留的草稿');
   await expect(page.locator('#chat .chat-main')).toBeVisible();
   await page.screenshot({path:shots+`/chat-${size.width}.png`});
 }
 expect(calls.some(c=>c.path==='/chat/conversations')).toBe(true);
 expect(errors).toEqual([]);
});
test('final UX: search failure, topbar navigation, and stale responses stay distinct',async({page})=>{
 const {errors}=await setup(page);
 await page.getByRole('button',{name:'编写活动',exact:true}).click();
 await page.locator('.desktop-topbar input[type="search"]').fill('测试联系人乙');
 await page.locator('.desktop-topbar input[type="search"]').press('Enter');
 await expect(page.locator('#chat')).toBeVisible();
 await expect(page.locator('[data-chat-id="80002"]')).toBeVisible();
 await expect(page.locator('[data-chat-id="80001"]')).toHaveCount(0);
 await page.route('**/api/chat/conversations?q=%E6%95%85%E9%9A%9C',r=>r.fulfill({status:503,json:{error:'测试服务暂不可用'}}));
 await page.locator('#chatSearch').fill('故障');
 await expect(page.locator('#chatConversations')).toContainText('会话加载失败，请重试');
 await page.unroute('**/api/chat/conversations?q=%E6%95%85%E9%9A%9C');
 let release;const held=new Promise(resolve=>release=resolve);
 await page.route('**/api/chat/conversations?q=%E6%85%A2',async r=>{await held;await r.fulfill({json:{rows:[{chat_id:'stale',title:'过期结果'}],next:null,cursor:50,totalUnread:0}});});
 await page.locator('#chatSearch').fill('慢');
 await page.locator('#chatSearch').fill('测试联系人乙');
 await expect(page.locator('[data-chat-id="80002"]')).toBeVisible();
 release();
 await expect(page.locator('[data-chat-id="stale"]')).toHaveCount(0);
 expect(errors).toEqual([]);
});
