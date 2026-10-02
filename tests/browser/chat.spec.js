import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { signedData, publisherToken } from '../helpers.js';

const secondToken='333333:LOCAL_TEST_SECOND_TOKEN_123456789';
async function telegram(page) {
  await page.route('https://telegram.org/js/telegram-web-app.js',route=>route.fulfill({contentType:'application/javascript',body:`window.Telegram={WebApp:{initData:${JSON.stringify(signedData())},ready(){},expand(){}}};`}));
}
test('account switch, webhook inbox, direct reply with button and persistent history',async({page,request})=>{
  await telegram(page);await page.goto('/');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('#token').fill(publisherToken);await page.locator('#savePublisher').click();
  await page.getByRole('button',{name:'聊天',exact:true}).click();
  await expect(page.locator('#inboxStatus')).toContainText('尚未启用');
  await page.locator('#enableInbox').click();await expect(page.locator('#inboxStatus')).toContainText('已启用');
  const {secret}=JSON.parse(fs.readFileSync('test-results/publisher-secret-222222.json','utf8'));
  const update={update_id:10,message:{message_id:10,date:Math.floor(Date.now()/1000),chat:{id:444444,type:'private'},from:{id:444444,first_name:'测试会话'},text:'你好，活动还在吗？'}};
  expect((await request.post('/tg/publisher/222222',{headers:{'x-telegram-bot-api-secret-token':secret},data:update})).status()).toBe(200);
  await expect(page.locator('#chatConversations')).toContainText('测试会话',{timeout:8000});
  await page.locator('[data-chat-id="444444"]').click();await expect(page.locator('#chatMessages')).toContainText('你好，活动还在吗？');
  await page.locator('#chatInput .ql-editor').fill('活动仍在进行');
  await page.locator('#chatEmoji').click();await page.locator('#packSettings summary').click();
  await page.locator('#pack').fill('https://t.me/addemoji/test_pack');await page.locator('#loadPack').click();
  await page.locator('.emoji-choice').first().click();await expect(page.locator('#chatInput .custom-emoji')).toHaveCount(1);
  await page.locator('#closeEmoji').click();
  await page.locator('#chatAddButton').click();
  await page.locator('[data-chat-button="0"][data-field="text"]').fill('查看活动');
  await page.locator('[data-chat-button="0"][data-field="url"]').fill('https://t.me/example');
  await page.locator('[data-chat-icon="0"]').click();await page.locator('.emoji-choice').nth(1).click();await page.locator('#closeEmoji').click();
  await page.locator('#chatSend').click();
  await expect(page.locator('#chatMessages')).toContainText('活动仍在进行');
  await page.reload();await expect(page.locator('#chatConversations')).toContainText('测试会话');
  await page.locator('[data-chat-id="444444"]').click();await expect(page.locator('#chatMessages')).toContainText('活动仍在进行');
  const headers={'x-telegram-init-data':signedData(),'x-publisher-id':'222222'};
  const files=[
    {name:'image.png',mime:'image/png',data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/C9sAAAAASUVORK5CYII=','base64'),kind:'photo'},
    {name:'clip.mp4',mime:'video/mp4',data:Buffer.from('test-video'),kind:'video'},
    {name:'paper.pdf',mime:'application/pdf',data:Buffer.from('%PDF-test'),kind:'document'}
  ];
  let documentRow;
  for(const file of files){
    const upload=await request.post('/api/chat/media',{headers,multipart:{file:{name:file.name,mimeType:file.mime,buffer:file.data}}});
    expect(upload.ok()).toBeTruthy();const media=await upload.json();
    const sent=await request.post('/api/chat/conversations/444444/send',{headers,data:{delta:{ops:[{insert:'\n'}]},buttons:[],mediaId:media.id,replyTo:'10'}});
    expect(sent.ok()).toBeTruthy();const row=await sent.json();expect(row.media_kind).toBe(file.kind);expect(row.reply_to_message_id).toBe('10');
    if(file.kind==='document')documentRow=row;
  }
  const history=await(await request.get('/api/chat/conversations/444444/messages',{headers})).json();
  const textRow=history.rows.find(row=>row.direction==='OUT'&&!row.media_kind);
  expect((await request.post(`/api/sent/chat/${textRow.id}`,{headers,data:{action:'edit',delta:{ops:[{insert:'活动照常进行\n'}]},buttons:[]}})).ok()).toBeTruthy();
  expect((await request.post(`/api/sent/chat/${documentRow.id}`,{headers,data:{action:'delete'}})).ok()).toBeTruthy();
  await expect(page.locator('#chatMessages')).toContainText('活动照常进行',{timeout:8000});
  await expect(page.locator('#chatMessages')).toContainText('[已删除]',{timeout:8000});
  await page.reload();await page.locator('[data-chat-id="444444"]').click();
  await expect(page.locator('#chatMessages')).toContainText('活动照常进行');
  await expect(page.locator('#chatMessages')).toContainText('[已删除]');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/chat-workspace.png',fullPage:true});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('#token').fill(secondToken);await page.locator('#savePublisher').click();
  await page.getByRole('button',{name:'聊天',exact:true}).click();
  await expect(page.locator('#chatConversations')).not.toContainText('测试会话');
  await page.locator('#publisherSelect').selectOption('222222');
  await expect(page.locator('#chatConversations')).toContainText('测试会话');
});
