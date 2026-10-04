import {test,expect} from '@playwright/test';
import {signedData} from '../helpers.js';
const first='222222',second='333333',base='http://127.0.0.1:8101';
const csv=rows=>Buffer.from('ID,昵称,telegram_id\n'+rows.map((r,i)=>`${i+1},${r[1]},${r[0]}`).join('\n')+'\n');
async function account(request,username='wz994604',password='test-owner-password'){
 const r=await request.post('/auth/login',{headers:{origin:base},data:{username,password}});expect(r.status()).toBe(200);
 const cookie=r.headers()['set-cookie'].split(';')[0];
 return (id='')=>({cookie,origin:base,...(id?{'x-publisher-id':id}:{})});
}
async function bind(request){const headers=await account(request);for(const id of [first,second])expect((await request.post('/api/publisher',{headers:headers(),data:{token:id+':LOCAL_TEST_PUBLISH_TOKEN_123456789'}})).status()).toBe(200);return headers;}
async function upload(request,headers,id,rows){return request.post('/api/players/import',{headers:headers(id),multipart:{file:{name:'fixture.csv',mimeType:'text/csv',buffer:csv(rows)}}});}
async function seed(request){const h=await bind(request);await upload(request,h,first,[['80001','A common'],['81001','A only']]);await upload(request,h,second,[['80001','B common'],['83000','B only']]);return h;}
async function login(page,username='wz994604',password='test-owner-password'){
 await page.route('https://telegram.org/js/telegram-web-app.js',r=>r.fulfill({contentType:'application/javascript',body:'window.Telegram={WebApp:{initData:"",ready(){},expand(){}}};'}));
 await page.goto('/');await expect(page.locator('#locked')).toBeVisible();await page.locator('#loginUsername').fill(username);await page.locator('#loginPassword').fill(password);await page.locator('#loginForm button').click();await expect(page.locator('#workspace')).toBeVisible();
}
async function switchTo(page,id){if((await page.locator('#publisherSelect').inputValue())===id)return;await page.locator('#publisherSelect').selectOption(id);await expect(page.locator('#identity')).toContainText(id===first?'local_test_publisher':'local_test_second');await expect(page.locator('#playerStats')).toContainText('第 1 页');}
async function users(page){await page.locator('[data-rail-tab="players"]').click();await expect(page.locator('#players')).toBeVisible();if(!(await page.locator('#usersPanel').evaluate(n=>n.open)))await page.locator('#usersPanel summary').click();await expect(page.locator('#playerStats')).toContainText('第 1 页');}

test('API: every bot imports/syncs independently; search/pages/IDs/sending and account scopes stay isolated',async({request})=>{
 const h=await bind(request);
 const a=[['80001','A common'],['81001','A only'],...Array.from({length:51},(_,i)=>[String(91000+i),'A page '+i])];
 const b=[['80001','B common'],['83000','B only'],...Array.from({length:51},(_,i)=>[String(93000+i),'B page '+i])];
 for(const [id,rows] of [[first,a],[second,b]]){const r=await upload(request,h,id,rows);expect(r.status()).toBe(200);expect((await r.json()).created).toBe(53);}
 const search=async(id,q)=>{const r=await request.get('/api/players?q='+q+'&size=10',{headers:h(id)});expect(r.status()).toBe(200);return r.json();};
 expect((await search(first,'B page')).total).toBe(0);expect((await search(second,'A page')).total).toBe(0);
 for(const [id,prefix] of [[first,'A'],[second,'B']]){const one=await search(id,'');const all=[];for(let page=1;page<=Math.ceil(one.total/10);page++){const r=await (await request.get('/api/players?size=10&page='+page,{headers:h(id)})).json();all.push(...r.rows);}expect(all).toHaveLength(53);expect(all.every(p=>p.display_name.startsWith(prefix))).toBe(true);}
 expect((await request.post('/api/ffa/token',{headers:h(first),data:{token:'SYNTHETIC_SOURCE_A_1234567890'}})).status()).toBe(200);
 expect((await request.post('/api/ffa/sync',{headers:h(first)})).status()).toBe(200);
 expect((await (await request.get('/api/ffa',{headers:h(second)})).json()).configured).toBe(false);
 expect((await request.post('/api/ffa/sync',{headers:h(second)})).status()).toBe(400);
 expect((await request.post('/api/ffa/token',{headers:h(second),data:{token:'SYNTHETIC_SOURCE_B_1234567890'}})).status()).toBe(200);
 expect((await request.post('/api/ffa/sync',{headers:h(second)})).status()).toBe(200);
 expect((await search(first,'80001')).rows[0].display_name).toBe('A common');expect((await search(second,'80001')).rows[0].display_name).toBe('B common');
 const ids=await (await request.get('/api/players/ids',{headers:h(second)})).json();expect(ids.rows.some(p=>p.telegram_id==='81001')).toBe(false);
 await Promise.all([await upload(request,h,first,[['98001','A concurrent']]),await upload(request,h,second,[['98001','B concurrent']])]);
 expect((await search(first,'98001')).rows[0].display_name).toBe('A concurrent');expect((await search(second,'98001')).rows[0].display_name).toBe('B concurrent');
 const payload=playerIds=>({name:'Isolated fake private message',delta:{ops:[{insert:'synthetic test only\n'}]},buttons:[],playerIds});
 expect((await request.post('/api/broadcasts',{headers:h(second),data:payload(['80001','81001'])})).status()).toBe(400);
 expect(await (await request.get('/api/broadcasts',{headers:h(second)})).json()).toEqual([]);
 const send=await request.post('/api/broadcasts',{headers:h(second),data:payload(['80001'])});expect(send.status()).toBe(200);const id=(await send.json()).id;
 await expect.poll(async()=>{const r=await (await request.get('/api/broadcasts/'+id,{headers:h(second)})).json();return r.deliveries[0].status;}).toBe('SUCCESS');
 // The delivery status and scheduler bot-token unit test jointly verify the selected bot send path.
 expect((await request.get('/api/broadcasts/'+id,{headers:h(first)})).status()).toBe(404);
 const op=await account(request,'operator','test-operator-password');const home=await (await request.get('/api/bootstrap',{headers:op()})).json();expect(home.admin.canManageBots).toBe(false);expect(home.publisher.id).toBe(second);expect(home.publishers.map(p=>p.id)).toEqual([second]);
 for(const route of ['/api/players','/api/players/ids','/api/ffa'])expect((await request.get(route,{headers:op(first)})).status()).toBe(403);
 expect((await upload(request,op,first,[['99099','no permission']])).status()).toBe(403);
 expect((await request.post('/api/ffa/sync',{headers:op(first)})).status()).toBe(403);
 expect((await request.post('/api/broadcasts',{headers:op(first),data:payload(['80001'])})).status()).toBe(403);
 expect((await upload(request,op,second,[['99098','operator permitted']])).status()).toBe(200);
 expect((await request.post('/api/publisher',{headers:op(second),data:{token:first+':LOCAL_TEST_PUBLISH_TOKEN_123456789'}})).status()).toBe(403);
 expect((await request.post('/api/inbox/enable',{headers:op(second),data:{takeover:true}})).status()).toBe(403);
 expect((await request.post('/api/publisher',{headers:{'x-telegram-init-data':signedData()},data:{token:first+':LOCAL_TEST_PUBLISH_TOKEN_123456789'}})).status()).toBe(403);
 expect((await request.get('/api/players',{headers:{'x-telegram-init-data':signedData(),'x-publisher-id':second}})).status()).toBe(200);
 expect((await request.get('/api/players',{headers:h('444444')})).status()).toBe(401);
});

test('UI: import works on second bot; switching clears selected names, search, page and old file picker',async({page,request})=>{
 await seed(request);const errors=[];page.on('pageerror',e=>errors.push(e.message));await login(page);await users(page);
 await page.locator('[data-player-id="80001"]').check();await expect(page.locator('#playerSelectionCount')).toContainText('1 人');
 await page.locator('#playerSearch').fill('A');await page.locator('#refreshPlayers').click();await page.locator('#nextPlayers').click();await expect(page.locator('#playerStats')).toContainText('第 2 页');
 await switchTo(page,second);await expect(page.locator('#playerSearch')).toHaveValue('');await expect(page.locator('#playerSelectionCount')).toContainText('0 人');await expect(page.locator('#selectedPlayerList')).not.toContainText('A common');
 await expect(page.locator('#importPlayers')).toBeVisible();await expect(page.locator('#syncPlayers')).toBeVisible();await expect(page.locator('#playerList')).not.toContainText('A only');
 const calls=[];page.on('request',r=>{if(r.url().endsWith('/api/players/import'))calls.push(r.headers()['x-publisher-id']);});
 const choosing=page.waitForEvent('filechooser');await page.locator('#importPlayers').click();await (await choosing).setFiles({name:'ui-b.csv',mimeType:'text/csv',buffer:csv([['99001','UI B imported']])});
 await expect(page.locator('#playerList')).toContainText('UI B imported');expect(calls).toEqual([second]);
 await switchTo(page,first);await expect(page.locator('#playerList')).not.toContainText('UI B imported');
 const pending=page.waitForEvent('filechooser');await page.locator('#importPlayers').click();const chooser=await pending;await switchTo(page,second);await chooser.setFiles({name:'stale.csv',mimeType:'text/csv',buffer:csv([['99002','must not import']])});
 await expect(page.locator('#toast')).toContainText('重新为当前机器人选择 CSV');expect(calls).toEqual([second]);expect(errors).toEqual([]);
});

test('UI: delayed select-all/list/sync results cannot restore another bot or an old A-B-A context',async({page,request})=>{
 await seed(request);await login(page);await users(page);
 let releaseIds,idsStarted;const heldIds=new Promise(r=>releaseIds=r),startedIds=new Promise(r=>idsStarted=r);
 await page.route('**/api/players/ids',async r=>{const response=await r.fetch();idsStarted();await heldIds;await r.fulfill({response});});
 await page.locator('#selectAllPlayers').click();await startedIds;await switchTo(page,second);await switchTo(page,first);releaseIds();await expect(page.locator('#selectAllPlayers')).toBeEnabled();await expect(page.locator('#playerSelectionCount')).toContainText('0 人');await page.unroute('**/api/players/ids');
 let releaseList,listStarted;const heldList=new Promise(r=>releaseList=r),startedList=new Promise(r=>listStarted=r);
 await page.route('**/api/players?*',async r=>{if(r.request().headers()['x-publisher-id']===first && new URL(r.request().url()).searchParams.get('q')==='A only'){const response=await r.fetch();listStarted();await heldList;await r.fulfill({response});}else await r.continue();});
 await page.locator('#playerSearch').fill('A only');await page.locator('#refreshPlayers').click();await startedList;await switchTo(page,second);releaseList();await expect(page.locator('#refreshPlayers')).toBeEnabled();await expect(page.locator('#playerList')).not.toContainText('A only');await page.unroute('**/api/players?*');
 await switchTo(page,first);let releaseSync,syncStarted;const heldSync=new Promise(r=>releaseSync=r),startedSync=new Promise(r=>syncStarted=r);
 await page.route('**/api/ffa/sync',async r=>{const response=await r.fetch();syncStarted();await heldSync;await r.fulfill({response});});
 await page.locator('#syncPlayers').click();await startedSync;await switchTo(page,second);releaseSync();await expect(page.locator('#syncPlayers')).toBeEnabled();await expect(page.locator('#playerList')).not.toContainText('A only');await expect(page.locator('#playerSelectionCount')).toContainText('0 人');
});

test('UI: ordinary admin loads permitted context even with old local selection and cannot configure bots',async({page,request})=>{
 await seed(request);await page.addInitScript(()=>localStorage.setItem('tgzhushou:selected-publisher','222222'));
 await login(page,'operator','test-operator-password');await expect(page.locator('#publisherSelect')).toHaveValue(second);await expect(page.locator('#publisherSelect option')).toHaveCount(1);await users(page);
 await expect(page.locator('#importPlayers')).toBeVisible();await expect(page.locator('#syncPlayers')).toBeVisible();await page.locator('[data-rail-tab="settings"]').click();await expect(page.locator('#savePublisher')).toBeHidden();await expect(page.locator('#token')).toBeDisabled();
});
