import fs from 'node:fs';
import {test,expect} from '@playwright/test';
import {signedData,publisherToken} from '../helpers.js';

test('authenticated Rail pages fit desktop and mobile viewports',async({page})=>{
  await page.route('https://telegram.org/js/telegram-web-app.js',route=>route.fulfill({contentType:'application/javascript',body:`window.Telegram={WebApp:{initData:${JSON.stringify(signedData())},ready(){},expand(){}}};`}));
  await page.goto('/');
  await page.locator('nav button[data-tab="settings"]').click();
  await page.locator('#token').fill(publisherToken);
  await page.locator('#savePublisher').click();
  await expect(page.locator('#railBots .rail-bot').first()).toBeVisible();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toBeHidden({timeout:8000});
  fs.mkdirSync('test-results/rail-visual',{recursive:true});
  const tabs=[['chat','聊天'],['editor','编写'],['players','用户'],['tasks','任务'],['logs','记录'],['settings','设置']];
  for(const [width,height] of [[1920,1080],[1280,800],[1024,768],[390,844],[430,932]]){
    await page.setViewportSize({width,height});
    for(const [id,label] of tabs){
      const tabButton=width<900
        ? page.locator(`nav button[data-tab="${id}"]`)
        : page.locator(`.rail-nav [data-rail-tab="${id}"]`);
      await expect(tabButton).toBeVisible();
      await tabButton.click();
      await expect(page.locator(`#${id}`)).toBeVisible();
      const geometry=await page.locator(`#${id}`).evaluate(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};});
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width+1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({path:`test-results/rail-visual/${width}x${height}-${id}.png`});
    }
  }
});
