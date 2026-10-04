import {test,expect} from '@playwright/test';

test('account form and inbox toggle show the correct permissions and submit selected scope',async({page})=>{
  let inbox=true;const calls=[];const publishers=[{id:'222222',username:'synthetic_bot'}];
  await page.route('https://telegram.org/js/telegram-web-app.js',route=>route.fulfill({contentType:'application/javascript',body:''}));
  await page.route('**/auth/admin-accounts',route=>{
    if(route.request().method()==='POST'){calls.push(route.request().postDataJSON());return route.fulfill({status:201,json:{username:'newoperator'}});}
    return route.fulfill({json:{accounts:[{username:'wz9946'}],publishers}});
  });
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/bootstrap')return route.fulfill({json:{admin:{id:'123',name:'wz9946',canManageAccounts:true,canManageBots:true},publishers,publisher:publishers[0],targets:[],tasks:[]}});
    if(path==='/api/inbox/status')return route.fulfill({json:{status:inbox?'READY':'AVAILABLE',enabled:inbox}});
    if(path==='/api/inbox/disable'){inbox=false;return route.fulfill({json:{status:'AVAILABLE',enabled:false}});}
    if(path==='/api/inbox/enable'){inbox=true;return route.fulfill({json:{status:'READY',enabled:true}});}
    if(path==='/api/sticker-packs/saved')return route.fulfill({json:{packs:[]}});
    if(path==='/api/ffa')return route.fulfill({json:{configured:false}});
    return route.fulfill({json:{rows:[],cursor:0,totalUnread:0}});
  });
  await page.goto('/');await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#enableInbox')).toHaveText('关闭收消息');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#enableInbox').click();await expect(page.locator('#enableInbox')).toHaveText('启用收消息');
  await page.locator('#enableInbox').click();await expect(page.locator('#enableInbox')).toHaveText('关闭收消息');
  await page.locator('[data-rail-tab="settings"]').click();await page.getByRole('button',{name:'管理账号',exact:true}).click();
  await page.locator('#addAccount').click();await page.locator('#newAccountUsername').fill('newoperator');await page.locator('#newAccountPassword').fill('synthetic-password');await page.locator('[name=accountPublisher]').check();
  await page.screenshot({path:'diagnostics/account-inbox-20261005/account-form.png'});
  await page.getByRole('button',{name:'保存账号',exact:true}).click();await expect(page.locator('#accountForm')).toBeHidden();
  expect(calls).toEqual([{username:'newoperator',password:'synthetic-password',publisherIds:['222222']}]);
});
