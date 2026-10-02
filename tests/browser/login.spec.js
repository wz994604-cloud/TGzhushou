import fs from 'node:fs';
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { entryToken, publisherToken } from '../helpers.js';

test('one-time browser link opens PWA without Mini App initData',async({page,request})=>{
  fs.rmSync('test-results/browser-login.json',{force:true});
  const secret=crypto.createHash('sha256').update(`entry:${entryToken}`).digest('hex');
  const sent=await request.post('/tg/entry',{headers:{'x-telegram-bot-api-secret-token':secret},data:{message:{chat:{id:123456,type:'private'},from:{id:123456},text:'/login'}}});
  expect(sent.status()).toBe(200);
  await expect.poll(()=>fs.existsSync('test-results/browser-login.json')).toBe(true);
  const {url}=JSON.parse(fs.readFileSync('test-results/browser-login.json','utf8'));
  const token=new URL(url).hash;
  await page.goto('/'+token);
  const manifest=await request.get('/manifest.webmanifest');expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe('standalone');
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#locked')).toBeHidden();
  expect(await page.evaluate(()=>location.hash)).toBe('');
  await page.reload();await expect(page.locator('#workspace')).toBeVisible();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('#token').fill(publisherToken);await page.locator('#savePublisher').click();
  await expect(page.locator('#publisher')).toContainText('local_test_publisher');
  await page.locator('#browserLogout').click();await expect(page.locator('#locked')).toBeVisible();
  expect((await request.post('/auth/exchange',{data:{token:token.slice('#login='.length)}})).status()).toBe(401);
});
