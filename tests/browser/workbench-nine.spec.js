import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const shots='.design/nine-requirements-20261004/screenshots';fs.mkdirSync(shots,{recursive:true});
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
   calls.push({path,method:req.method(),body:req.postData()});
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
 await page.goto('/');await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#enableInbox')).toBeVisible();
 return {calls,errors};
}
async function go(page,id){await page.locator(`[data-${(await page.locator('#workspace').evaluate(n=>n.classList.contains('mini-shell')))?'tab':'rail-tab'}="${id}"]`).click();await expect(page.locator('#'+id)).toBeVisible();}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}

test('1 chat: real selection, one date per day, bounded composer/history, opt-in details and takeover request',async({page})=>{
 const {calls,errors}=await setup(page);await expect(page.locator('#chatComposer')).toBeHidden();await expect(page.locator('#chatHeader')).toBeHidden();await expect(page.locator('.chat-details')).toBeHidden();
 expect(calls.some(c=>c.path==='/inbox/enable')).toBe(false);await page.locator('#enableInbox').click();await expect(page.locator('#inboxStatus')).toContainText('可正常接收');expect(JSON.parse(calls.find(c=>c.path==='/inbox/enable').body)).toEqual({takeover:true});
 await page.locator('[data-chat-id="80001"]').click();await expect(page.locator('.chat-bubble')).toHaveCount(50);await expect(page.locator('.chat-date-divider')).toHaveCount(2);await expect(page.locator('.chat-bubble small').first()).toHaveText(/^\d\d:\d\d$/);
 const bounds=await page.locator('#chatComposer').boundingBox();expect(bounds.y+bounds.height).toBeLessThanOrEqual(900);expect(await page.locator('#chatMessages').evaluate(n=>n.scrollHeight>n.clientHeight)).toBe(true);
 await page.locator('#showChatDetails').click();await expect(page.locator('.chat-details')).toBeVisible();await page.getByRole('button',{name:'关闭会话资料'}).click();await expect(page.locator('.chat-details')).toBeHidden();
 await noOverflow(page);await page.setViewportSize({width:1440,height:600});expect(await page.locator('.app-rail').evaluate(n=>n.scrollHeight<=n.clientHeight)).toBe(true);expect((await page.locator('#chatComposer').boundingBox()).y).toBeLessThan(600);await page.setViewportSize({width:1440,height:900});await page.screenshot({path:shots+'/desktop-chat.png'});expect(errors).toEqual([]);
});

test('2 settings: a single category, real multi-bot list and independent account context',async({page})=>{
 const {calls,errors}=await setup(page);await go(page,'settings');await expect(page.locator('.settings-forms>.card:visible')).toHaveCount(1);await expect(page.locator('#boundPublisherList .list-row')).toHaveCount(2);
 await page.locator('.settings-categories button').filter({hasText:'管理账号'}).click();await expect(page.locator('#adminInfo')).toBeVisible();await expect(page.locator('#token')).toBeHidden();await expect(page.locator('.settings-forms>.card:visible')).toHaveCount(1);
 await page.screenshot({path:shots+'/desktop-settings.png'});await page.locator('.settings-categories button').filter({hasText:'绑定机器人'}).click();await page.locator('[data-bound-bot="333333"]').click();await expect(page.locator('#publisherSelect')).toHaveValue('333333');expect(calls.some(c=>/accounts|password/.test(c.path))).toBe(false);expect(errors).toEqual([]);
});

test('3 users: real fields, selection and existing conversation entry, no fake delete',async({page})=>{
 const {calls,errors}=await setup(page);await go(page,'players');await expect(page.locator('.user-table-row')).toHaveCount(2);await expect(page.locator('#playerList')).toContainText('最近互动');await expect(page.locator('#playerList')).toContainText('test_a');await page.locator('[data-player-id="80001"]').check();await expect(page.locator('#playerSelectionCount')).toContainText('1 人');await page.screenshot({path:shots+'/desktop-users.png'});
 await page.locator('[data-player-chat="80001"]').click();await expect(page.locator('#chatTitle')).toContainText('测试联系人甲');await expect(page.locator('#chatComposer')).toBeVisible();expect(calls.some(c=>c.method==='DELETE'&&c.path.startsWith('/players'))).toBe(false);expect(errors).toEqual([]);
});

test('4 tasks/logs: no timed task, categorized results and actual failure details',async({page})=>{
 const {errors}=await setup(page);await go(page,'tasks');await expect(page.locator('#noTimedTasks')).toBeVisible();await page.screenshot({path:shots+'/desktop-tasks.png'});await go(page,'logs');await expect(page.locator('#runList')).toContainText('频道发布测试');await expect(page.locator('#broadcastPanel')).toBeHidden();await page.locator('[data-run="1"] summary').click();await page.locator('[data-run-detail="1"]').click();await expect(page.locator('#sentRecipients')).toContainText('机器人缺少权限');await page.locator('#closeSent').click();await page.locator('#logs .task-filters button').filter({hasText:'用户'}).click();await expect(page.locator('#broadcastList')).toContainText('用户发布测试');await expect(page.locator('#runList')).toBeHidden();await page.screenshot({path:shots+'/desktop-records.png'});expect(errors).toEqual([]);
});

test('5 editing: paired rows, manual preservation, same saved and preview rows, pinned controls',async({page})=>{
 const {calls,errors}=await setup(page);await go(page,'editor');await page.locator('#name').fill('两列按钮测试');await page.locator('#toggleWriting').click();await page.locator('#message .ql-editor').fill('真实编辑流程的合成文案');await page.locator('[name=target]').first().check();
 for(let i=0;i<4;i++)await page.locator('#addButton').click();expect(await page.locator('[data-field=row]').evaluateAll(ns=>ns.map(n=>n.value))).toEqual(['1','1','2','2']);
 await expect(page.locator('.preview-row')).toHaveCount(2);await page.locator('[data-field=row]').nth(2).fill('7');await page.locator('[data-remove="0"]').click();expect(await page.locator('[data-field=row]').evaluateAll(ns=>ns.map(n=>n.value))).toEqual(['1','7','2']);
 await page.locator('#save').click();await expect(page.locator('#saveStatus')).toContainText('服务器已保存');const payload=JSON.parse(calls.find(c=>c.path==='/tasks').body);expect(payload.buttons.map(b=>b.row)).toEqual([0,6,1]);await page.locator('#send').click();await expect(page.locator('#toast')).toContainText('已加入发送队列');expect(calls.some(c=>c.path==='/tasks/9/send')).toBe(true);
 const bar=await page.locator('.desktop-editor-actions').boundingBox();expect(bar.y+bar.height).toBeLessThanOrEqual(900);await page.locator('.desktop-viewport').evaluate(n=>n.scrollTop=n.scrollHeight);expect((await page.locator('.desktop-editor-actions').boundingBox()).y).toBe(bar.y);
 await noOverflow(page);await page.locator('.desktop-viewport').evaluate(n=>n.scrollTop=0);await page.screenshot({path:shots+'/desktop-editor.png'});expect(errors).toEqual([]);
});

test('6 assets/emoji: actual upload IDs, preserved draft, scoped search/save and retained invalid URL',async({page})=>{
 const {calls,errors}=await setup(page);await go(page,'editor');await page.locator('#name').fill('素材保留草稿');await go(page,'assets');await page.locator('#assetUpload').setInputFiles({name:'sample.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic fixture')});await expect(page.locator('[data-asset-use]')).toHaveCount(1);await page.locator('[data-asset-use]').click();await expect(page.locator('#name')).toHaveValue('素材保留草稿');await expect(page.locator('#photoMeta')).toContainText('sample.txt');await page.locator('#bodyEmoji').hover();await expect(page.locator('#emojiDialog')).toBeVisible();await page.locator('#bodyEmoji').click();await expect(page.locator('#emojiDialog')).toBeVisible();await page.locator('#packSettings').evaluate(n=>n.open=true);await page.locator('#pack').fill('https://t.me/addemoji/bad_pack');await page.locator('#loadPack').click();await expect(page.locator('#packError')).toContainText('链接无效');await expect(page.locator('#pack')).toHaveValue('https://t.me/addemoji/bad_pack');
 await page.locator('#pack').fill('https://t.me/addemoji/test_pack');await page.locator('#loadPack').click();await expect(page.locator('.emoji-choice')).toHaveCount(2);await page.locator('#emojiSearch').fill('5432101234567890124');await expect(page.locator('.emoji-choice')).toHaveCount(1);await page.locator('.emoji-choice').click();await expect(page.locator('#message .custom-emoji')).toHaveCount(1);await page.locator('#packSettings').evaluate(n=>n.open=true);await page.locator('#savePack').click();await expect(page.locator('#toast')).toContainText('已保存');await page.screenshot({path:shots+'/desktop-emoji.png'});await page.locator('#closeEmoji').click();await go(page,'assets');await expect(page.locator('#assetPacks .asset-pack')).toHaveCount(1);await page.screenshot({path:shots+'/desktop-assets.png'});await go(page,'chat');await page.locator('[data-chat-id="80001"]').click();await go(page,'assets');await page.locator('[data-asset-pack][data-pack-target="chat"]').click();await page.locator('.emoji-choice').first().click();await expect(page.locator('#chatInput .custom-emoji')).toHaveCount(1);expect(calls.find(c=>c.path==='/sticker-packs/saved'&&c.method==='POST')).toBeTruthy();expect(errors).toEqual([]);
});

test('7 Mini independent steps, 44px controls and bottom composer after viewport shrinking',async({page})=>{
 await page.setViewportSize({width:390,height:844});const {errors}=await setup(page,{mini:true});await expect(page.locator('.mini-shell')).toBeVisible();await expect(page.locator('.app-rail')).toHaveCount(0);await expect(page.locator('.mini-nav button')).toHaveCount(6);await go(page,'editor');await expect(page.locator('.mini-editor-step:visible')).toHaveCount(1);await page.locator('#name').fill('Mini 独立编写');await page.screenshot({path:shots+'/mini-editor.png'});await page.locator('#miniNext').click();await expect(page.locator('#addButton')).toBeVisible();await go(page,'chat');await page.locator('[data-chat-id="80001"]').click();await page.setViewportSize({width:390,height:520});
 await expect(page.locator('#chatSend')).toBeVisible();const rect=await page.locator('#chatComposer').boundingBox();const nav=await page.locator('.mini-nav').boundingBox();expect(rect.y+rect.height).toBeLessThanOrEqual(nav.y+1);const small=await page.locator('#chatSend').boundingBox();expect(small.height).toBeGreaterThanOrEqual(44);await noOverflow(page);await page.screenshot({path:shots+'/mini-chat-short.png'});expect(errors).toEqual([]);
});

test('8 browser responsiveness, empty/loading/permission/retry states',async({page})=>{
 const {errors}=await setup(page,{empty:true});await go(page,'players');await expect(page.locator('#playerList')).toContainText('暂无用户');await page.route('**/api/players?*',r=>r.fulfill({status:403,json:{error:'测试：无权限'}}));await page.locator('#refreshPlayers').click();await expect(page.locator('#toast')).toContainText('无权限');await go(page,'players');await expect(page.locator('#players .surface-feedback')).toContainText('无访问权限');await page.screenshot({path:shots+'/desktop-error.png'});await page.unroute('**/api/players?*');await page.locator('#players .surface-feedback button').click();await expect(page.locator('#players .surface-feedback')).toBeHidden();let release;const held=new Promise(resolve=>release=resolve);await page.route('**/api/players?*',async r=>{await held;await r.fulfill({json:{rows:[],total:0}});});await page.locator('#refreshPlayers').click();await expect(page.locator('#players')).toHaveAttribute('aria-busy','true');await expect(page.locator('#players .surface-feedback')).toContainText('正在加载');release();await expect(page.locator('#players')).toHaveAttribute('aria-busy','false');await page.unroute('**/api/players?*');
 await page.setViewportSize({width:390,height:844});await expect(page.locator('.mini-shell')).toHaveCount(0);await page.getByRole('button',{name:'打开导航'}).click();await page.locator('[data-rail-tab="editor"]').click();await expect(page.locator('#editor')).toBeVisible();await noOverflow(page);expect(await page.locator('#workspace').evaluate(n=>n.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('.desktop-content').evaluate(n=>n.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:shots+'/web-narrow-editor.png'});expect(errors).toEqual([]);
});
