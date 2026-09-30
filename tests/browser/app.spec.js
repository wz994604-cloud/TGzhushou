import { test,expect } from '@playwright/test';
import { signedData,publisherToken } from '../helpers.js';

async function telegram(page,raw=signedData()) {
  await page.route('https://telegram.org/js/telegram-web-app.js',route=>route.fulfill({contentType:'application/javascript',body:`window.Telegram={WebApp:{initData:${JSON.stringify(raw)},ready(){},expand(){}}};`}));
}
test('browser and APIs reject missing or unauthorized Telegram identity',async({page,request})=>{
  await telegram(page,'');await page.goto('/');await expect(page.getByRole('heading',{name:'从 Telegram 打开'})).toBeVisible();
  expect((await request.get('/api/bootstrap')).status()).toBe(401);
  expect((await request.get('/api/bootstrap',{headers:{'x-telegram-init-data':signedData(999999)}})).status()).toBe(401);
});
test('mobile config, editor, emojis, saved draft, scheduler controls and delivery',async({page,request})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await telegram(page);await page.goto('/');
  await page.locator('#token').fill(publisherToken);await page.getByRole('button',{name:'验证并保存'}).click();await expect(page.locator('#publisher')).toContainText('local_test_publisher');
  for(const target of ['@test_channel','@test_group']){await page.locator('#targetRef').fill(target);await page.locator('#addTarget').click();await expect(page.locator('#targetRef')).toHaveValue('');}
  await page.getByRole('button',{name:'编写',exact:true}).click();await page.locator('#name').fill('每日活动测试');await page.locator('.ql-editor').fill('活动介绍\n点击进入频道');
  await page.locator('#bodyEmoji').click();await page.locator('#pack').fill('https://t.me/addemoji/test_pack');await page.locator('#loadPack').click();await page.locator('.emoji-choice').first().click();await expect(page.locator('.ql-editor .custom-emoji')).toHaveCount(1);await page.locator('#closeEmoji').click();
  await page.locator('#addButton').click();await page.locator('[data-field=url]').fill('https://t.me/example_bot');await page.locator('[data-field=style]').selectOption('success');await page.locator('[data-emoji="0"]').click();await page.locator('.emoji-choice').nth(1).click();await expect(page.locator('[data-emoji="0"]')).toContainText('更换专属表情');await page.locator('#closeEmoji').click();
  await page.locator('[name=target]').first().check();await page.locator('[name=target]').nth(1).check();
  await page.locator('#kind').selectOption('DAILY');await page.locator('#start').fill('22:00');await page.locator('#end').fill('02:00');await page.locator('#interval').fill('30');
  await page.reload();await expect(page.locator('#name')).toHaveValue('每日活动测试');await expect(page.locator('[data-field=style]')).toHaveValue('success');await expect(page.locator('.ql-editor .custom-emoji')).toHaveCount(1);
  await page.screenshot({path:'test-results/mobile-editor.png',fullPage:true});
  await page.locator('#activate').click();await expect(page.locator('#taskList')).toContainText('运行中');await page.locator('[data-action=pause]').click();await expect(page.locator('#taskList')).toContainText('已暂停');await page.locator('[data-action=activate]').click();await expect(page.locator('#taskList')).toContainText('运行中');
  await page.locator('[data-send-task]').click();await expect(page.locator('#toast')).toContainText('已加入发送队列');await page.getByRole('button',{name:'记录',exact:true}).click();
  await expect(async()=>{await page.locator('#refreshLogs').click();await expect(page.locator('#runList')).toContainText('成功 2 / 2');}).toPass({timeout:8000});await page.locator('#runList').getByText('每日活动测试',{exact:true}).click();await page.getByRole('button',{name:'查看各目标结果'}).click();await expect(page.locator('#runList')).toContainText('消息 ID 456');
  const auth={'x-telegram-init-data':signedData()};const tasks=await (await request.get('/api/bootstrap',{headers:auth})).json();const saved=await (await request.get(`/api/tasks/${tasks.tasks[0].id}`,{headers:auth})).json();expect(JSON.parse(saved.buttons_json)[0]).toMatchObject({style:'success',iconId:'5432101234567890124'});expect(saved.delta_json).toContain('5432101234567890123');
  await page.screenshot({path:'test-results/mobile-records.png',fullPage:true});expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('API links, photo upload, payload validation and request idempotency',async({request})=>{
  const headers={'x-telegram-init-data':signedData()};
  const bootstrap=await (await request.get('/api/bootstrap',{headers})).json();
  const image=await request.post('/api/media',{headers,multipart:{image:{name:'pixel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/C9sAAAAASUVORK5CYII=','base64')}}});expect(image.ok()).toBeTruthy();const media=await image.json();
  const payload={name:'图片链接测试',delta:{ops:[{insert:'点击进入频道',attributes:{link:'https://t.me/example'}},{insert:'\n'}]},buttons:[],mediaId:media.id,targetIds:bootstrap.targets.map(t=>t.id),schedule:{kind:'MANUAL'}};
  const created=await request.post('/api/tasks',{headers,data:payload});expect(created.ok()).toBeTruthy();const task=await created.json();
  const requestKey=crypto.randomUUID();const a=await (await request.post(`/api/tasks/${task.id}/send`,{headers,data:{requestKey}})).json();const b=await (await request.post(`/api/tasks/${task.id}/send`,{headers,data:{requestKey}})).json();expect(a.runId).toBe(b.runId);
  await expect(async()=>{const run=await(await request.get(`/api/runs/${a.runId}`,{headers})).json();expect(run.deliveries.every(d=>d.status==='SUCCESS'&&d.telegram_message_id==='457')).toBe(true);}).toPass({timeout:8000});
  expect((await request.post('/api/tasks',{headers,data:{...payload,targetIds:[99999]}})).status()).toBe(400);
  expect((await request.post('/api/tasks',{headers,data:{...payload,buttons:[{text:'x',url:'javascript:alert(1)'}]}})).status()).toBe(400);
  expect((await request.post('/api/publisher',{headers,data:{token:'111111:LOCAL_TEST_ENTRY_TOKEN_1234567890'}})).status()).toBe(400);
});
