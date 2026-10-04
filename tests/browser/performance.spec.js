import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { signedData, publisherToken } from '../helpers.js';

async function open(page, request) {
  const headers = { 'x-telegram-init-data':signedData() };
  await request.post('/api/publisher', { headers, data:{ token:publisherToken } });
  await request.post('/api/targets', { headers, data:{ reference:'@test_channel' } });
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    contentType:'application/javascript', body:`window.Telegram={WebApp:{initData:${JSON.stringify(headers['x-telegram-init-data'])},ready(){},expand(){}}};`
  }));
  await page.goto('/'); await expect(page.locator('#workspace')).toBeVisible();
  await page.getByRole('button', { name:'编写', exact:true }).click();
  return headers;
}

test('debounced draft, closed preview, reload flush and truthful server save status', async ({ page, request }) => {
  await open(page, request);
  expect(await page.locator('#toolbar .ql-link').count()).toBe(0);
  await page.evaluate(() => {
    window.draftWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'tgzhushou:draft:v1') window.draftWrites++; return original.call(this, key, value); };
  });
  await page.locator('#name').fill('输入减负');
  await page.locator('#toggleWriting').click();await page.locator('#message .ql-editor').pressSequentially('abcdef');
  expect(await page.evaluate(() => window.draftWrites)).toBeLessThanOrEqual(1);
  await expect(page.locator('#saveStatus')).toContainText('本机已暂存');
  expect(await page.evaluate(() => window.draftWrites)).toBeLessThanOrEqual(2);
  await expect(page.locator('#preview')).toBeEmpty();
  await page.locator('#previewPanel summary').click();
  await expect(page.locator('#preview')).toContainText('abcdef');
  await page.locator('#toggleWriting').evaluate(n=>{if(document.querySelector('#message .ql-editor').contentEditable==='false')n.click();});await page.locator('#message .ql-editor').fill('刷新前最后输入'); await page.reload();
  await expect(page.locator('#message .ql-editor')).toHaveText('刷新前最后输入');
  await page.locator('[name=target]').first().check(); await page.locator('#save').click();
  await expect(page.locator('#saveStatus')).toHaveText('服务器已保存');
  await page.locator('#name').fill('修改后未同步');
  await expect(page.locator('#saveStatus')).toContainText('尚未保存到服务器');
  await page.route('**/api/tasks/*', route => route.fulfill({ status:500, contentType:'application/json', body:'{"error":"模拟保存失败"}' }));
  await page.locator('#save').click(); await expect(page.locator('#saveStatus')).toContainText('服务器保存失败');
  await page.unroute('**/api/tasks/*');
  await page.setViewportSize({ width:390, height:460 });
  await page.locator('#name').focus();
  const bounds = await page.locator('.actions').boundingBox();
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(460);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => document.getElementById('toast').hidden = true);
  await page.screenshot({ path:'test-results/mobile-compact.png', fullPage:false });
});

test('emoji picker loads 24 at a time and reuses image blobs', async ({ page, request }) => {
  await open(page, request);
  const requests = []; page.on('request', r => { if (r.url().includes('/sticker-image?')) requests.push(r.url()); });
  await page.locator('#bodyEmoji').click(); await expandPack(page); await page.locator('#pack').fill('batch_pack'); await expandPack(page); await page.locator('#loadPack').click();
  await expect(page.locator('.emoji-choice')).toHaveCount(24);
  await expect.poll(() => requests.length).toBe(24);
  await expect(page.locator('.emoji-choice img')).toHaveCount(24);
  await page.locator('#emojiGrid').evaluate(node => { node.scrollTop = node.scrollHeight; }); await expect(page.locator('.emoji-choice')).toHaveCount(48);
  await expect(page.locator('.emoji-choice img')).toHaveCount(48);
  const before = requests.length;
  await page.locator('.emoji-choice').first().click(); await page.locator('#closeEmoji').click();
  await expect(page.locator('#message .ql-editor .custom-emoji img')).toHaveCount(1);
  await page.locator('#bodyEmoji').click(); await expandPack(page); await page.locator('#loadPack').click();
  await expect(page.locator('.emoji-choice img')).toHaveCount(24);
  expect(requests.length).toBe(before);
  await page.locator('#closeEmoji').click();
  await page.locator('#addButton').click(); await page.locator('[data-emoji="0"]').click();
  await page.locator('.emoji-choice').first().click(); await page.locator('#closeEmoji').click();
  await page.locator('#previewPanel summary').click();
  await expect(page.locator('.preview-button img')).toHaveCount(1);
  await expect(page.locator('.preview-button')).toContainText('立即进入');
  await page.locator('[data-clear="0"]').click(); await expect(page.locator('.preview-button img')).toHaveCount(0);
});

test('emoji keyboard keeps long text editable and inserts at different caret positions', async ({ page, request }) => {
  await open(page, request);
  const editor = page.locator('#message .ql-editor'); await page.locator('#toggleWriting').click();
  await editor.fill(Array.from({length:30}, (_,i) => '第' + (i+1) + '行活动文案').join('\n'));
  await page.locator('#bodyEmoji').click();
  const panel = page.locator('#emojiDialog');
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(node => node.matches(':modal'))).toBe(false);
  const bounds = await editor.boundingBox(), panelBounds = await panel.boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(panelBounds.y);
  await expect(editor).toHaveAttribute('inputmode', 'none');
  await expandPack(page); await page.locator('#pack').fill('batch_pack'); await expandPack(page); await page.locator('#loadPack').click();
  const first = editor.locator('p').first(); await first.click(); await editor.press('Home');
  await page.locator('.emoji-choice').first().click(); await page.locator('.emoji-choice').first().click();
  await expect(first.locator('.custom-emoji')).toHaveCount(2);
  expect(await first.evaluate(node => node.children[0].classList.contains('custom-emoji'))).toBe(true);
  const line20 = editor.locator('p').nth(19); await line20.scrollIntoViewIfNeeded(); await line20.click(); await editor.press('End');
  await page.locator('.emoji-choice').nth(1).click();
  await expect(line20.locator('.custom-emoji')).toHaveCount(1);
  await expect(first.locator('.custom-emoji')).toHaveCount(2);
  await expect(panel).toBeVisible();
  await page.screenshot({path:'test-results/emoji-keyboard-mobile.png'});
  await expandPack(page); await page.locator('#pack').fill('test_pack'); await expandPack(page); await page.locator('#loadPack').click();
  await expandPack(page); await page.locator('#packHistory').selectOption('batch_pack');
  await expect(page.locator('.emoji-choice')).toHaveCount(24);
  await page.locator('#closeEmoji').click(); await expect(panel).toBeHidden();
  await expect(editor).not.toHaveAttribute('inputmode', 'none');
  await page.reload(); await expect(editor.locator('.custom-emoji')).toHaveCount(3);
  // Same keyboard behavior in the wider Telegram desktop window shown by the user.
  await page.setViewportSize({width:530,height:760}); await page.locator('#bodyEmoji').click();
  const wide = await editor.boundingBox(), widePanel = await panel.boundingBox();
  expect(wide.y + wide.height).toBeLessThanOrEqual(widePanel.y);
  await page.screenshot({path:'test-results/emoji-keyboard-desktop.png'});
  await page.locator('#bodyEmoji').click(); await expect(panel).toBeHidden();
  await page.locator('#addButton').click(); await page.locator('[data-emoji="0"]').click();
  await expandPack(page); await page.locator('#pack').fill('test_pack'); await expandPack(page); await page.locator('#loadPack').click();
  await page.locator('.emoji-choice').first().click();
  await expect(editor.locator('.custom-emoji')).toHaveCount(3);
  await expect(page.locator('[data-emoji="0"]')).toContainText('更换专属表情');
  await page.locator('#closeEmoji').click();
});

test('thumbnail leaves original intact; private image auth and hashed asset caching', async ({ page, request }) => {
  const headers = await open(page, request);
  const original = await sharp({ create:{ width:1800, height:1200, channels:3, background:'#456abc' } }).png().toBuffer();
  const upload = await request.post('/api/media', { headers, multipart:{ image:{ name:'large.png', mimeType:'image/png', buffer:original } } });
  const media = await upload.json();
  const preview = await request.get(`/api/media/${media.id}?preview=1`, { headers });
  expect(preview.ok()).toBeTruthy(); const bytes = await preview.body();
  expect(await sharp(bytes).metadata()).toMatchObject({ width:720, height:480, format:'webp' });
  expect(bytes.length).toBeLessThan(original.length);
  expect(await (await request.get(`/api/media/${media.id}`, { headers })).body()).toEqual(original);
  expect(preview.headers()['cache-control']).toBe('private, max-age=3600');
  expect(preview.headers().vary).toContain('x-telegram-init-data');
  expect((await request.get(`/api/media/${media.id}?preview=1`)).status()).toBe(401);
  expect((await request.get('/api/sticker-image?id=mock_thumbnail_1')).status()).toBe(401);
  const sticker = await request.get('/api/sticker-image?id=mock_thumbnail_1', { headers });
  expect(sticker.ok()).toBeTruthy(); expect(sticker.headers()['cache-control']).toContain('private');
  const refreshedSticker = await request.get('/api/sticker-image?emoji=5432101234567890123', { headers });
  expect(refreshedSticker.ok()).toBeTruthy();
  const src = await page.locator('script[type=module]').getAttribute('src');
  expect((await request.get(src)).headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect((await request.get('/')).headers()['cache-control']).toBe('no-store');
  expect((await request.get('/api/bootstrap', { headers })).headers()['cache-control']).toBe('no-store');
  await page.locator('#photo').setInputFiles({ name:'large.png', mimeType:'image/png', buffer:original });
  await expect(page.locator('#photoBox')).toBeVisible();
  await expect.poll(() => page.locator('#photoPreview').evaluate(img => img.naturalWidth)).toBe(720);
  await page.reload();
  await expect.poll(() => page.locator('#photoPreview').evaluate(img => img.naturalWidth)).toBe(720);
  console.log(`Thumbnail ${original.length} -> ${bytes.length} bytes; original byte equality verified`);
});

test('unavailable custom emoji thumbnails degrade to alt text and stop retrying', async ({ page, request }) => {
  const headers = await open(page, request);
  const requests = []; page.on('request', r => { if (r.url().includes('/sticker-image?')) requests.push(r.url()); });
  await page.locator('#bodyEmoji').click(); await expandPack(page); await page.locator('#pack').fill('broken_pack'); await page.locator('#loadPack').click();
  await expect(page.locator('.emoji-choice')).toHaveCount(1); await expect(page.locator('.emoji-choice').first()).toHaveText('🧪');
  await expect(page.locator('.emoji-choice').first()).toHaveAttribute('data-image-state', 'unavailable');
  expect(requests.length).toBe(1);
  await expandPack(page); await page.locator('#pack').fill('broken_pack'); await page.locator('#loadPack').click();
  await expect(page.locator('.emoji-choice').first()).toHaveText('🧪'); expect(requests.length).toBe(1);
  const missing = await request.get('/api/sticker-image?emoji=9999999999999999999', { headers });
  expect(missing.status()).toBe(404); expect(missing.headers()['cache-control']).toContain('max-age=600');
  const animated = await request.get('/api/sticker-image?id=animated_12345&emoji=8888888888888888888', { headers });
  expect(animated.status()).toBe(404);
});


test('storage failure is visible and never mislabels a successful server save', async ({ page, request }) => {
  await open(page, request);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await page.locator('#name').fill('存储失败测试'); await page.locator('#toggleWriting').evaluate(n=>{if(document.querySelector('#message .ql-editor').contentEditable==='false')n.click();});await page.locator('#message .ql-editor').fill('仍可保存服务器');
  await page.locator('[name=target]').first().check();
  await expect(page.locator('#saveStatus')).toContainText('本机暂存失败');
  await page.locator('#save').click();
  await expect(page.locator('#saveStatus')).toHaveText('服务器已保存 · 本机暂存失败');
});


test('emoji keyboard backspace supports selection, graphemes, embeds, undo and hold release', async ({ page, request }) => {
  await open(page, request);
  const editor = page.locator('#message .ql-editor'), key = page.locator('#emojiBackspace'); await page.locator('#toggleWriting').click();
  await editor.fill('甲乙'); await editor.press('End');
  await page.locator('#bodyEmoji').click(); await key.click();
  await expect(editor).toHaveText('甲'); await expect(page.locator('#emojiDialog')).toBeVisible();
  await editor.press('Control+z'); await expect(editor).toHaveText('甲乙');
  await editor.fill('前👨‍👩‍👧‍👦'); await editor.press('End'); await key.click();
  await expect(editor).toHaveText('前');
  await editor.fill('第一行\n第二行');
  await editor.locator('p').nth(1).click(); await editor.press('Home'); await key.click();
  await expect(editor.locator('p')).toHaveCount(1); await expect(editor).toHaveText('第一行第二行');
  await editor.press('Home'); await key.click(); await expect(editor).toHaveText('第一行第二行');
  // The selection survives opening the panel, rather than collapsing to its start.
  await page.locator('#closeEmoji').click(); await editor.fill('选中文字'); await editor.press('Control+a');
  await page.locator('#bodyEmoji').click(); await key.click();
  await expect(editor).toHaveText(''); await editor.press('Control+z'); await expect(editor).toHaveText('选中文字');
  await editor.press('End'); await expandPack(page); await page.locator('#pack').fill('test_pack'); await expandPack(page); await page.locator('#loadPack').click();
  await page.locator('.emoji-choice').first().click(); await expect(editor.locator('.custom-emoji')).toHaveCount(1);
  await key.click(); await expect(editor.locator('.custom-emoji')).toHaveCount(0);
  await expect(editor).toHaveText('选中文字');
  await editor.fill('ABCDEFGHIJKLMNO'); await editor.press('End');
  const box = await key.boundingBox(); await page.mouse.move(box.x+box.width/2, box.y+box.height/2); await page.mouse.down();
  await page.waitForTimeout(760); await page.mouse.up();
  const remaining = await editor.innerText(); expect(remaining.trim().length).toBeLessThan(14); expect(remaining.trim().length).toBeGreaterThan(0);
  await page.waitForTimeout(300); await expect(editor).toHaveText(remaining.trim());
  await editor.press('Control+z'); await expect(editor).toHaveText('ABCDEFGHIJKLMNO');
  await page.screenshot({path:'test-results/emoji-delete-scroll.png'});
  await page.locator('#closeEmoji').click(); await page.locator('#addButton').click(); await page.locator('[data-emoji="0"]').click();
  await expect(key).toBeHidden(); await expect(editor).toHaveText('ABCDEFGHIJKLMNO');
});

test('emoji list scrolls to the last item without a load-more button', async ({ page, request }) => {
  await open(page, request); await page.locator('#bodyEmoji').click();
  await expandPack(page); await page.locator('#pack').fill('batch_pack'); await expandPack(page); await page.locator('#loadPack').click();
  await expect(page.locator('.emoji-choice')).toHaveCount(24);
  await expect(page.locator('#moreEmoji')).toHaveCount(0);
  for (const count of [48,60]) {
    await page.locator('#emojiGrid').evaluate(node => {node.scrollTop=node.scrollHeight;});
    await expect(page.locator('.emoji-choice')).toHaveCount(count);
  }
  await page.locator('.emoji-choice').last().click(); await expect(page.locator('#message .ql-editor .custom-emoji')).toHaveCount(1);
});

async function expandPack(page) { if (!(await page.locator('#packSettings').evaluate(n => n.open))) await page.locator('#packSettings summary').click(); }

test('pack controls collapse by default and after loading or switching', async ({page,request}) => {
  await open(page,request); await page.locator('#bodyEmoji').click();
  await expect(page.locator('#pack')).toBeHidden();
  const collapsedHeight = await page.locator('#emojiGrid').evaluate(n=>n.clientHeight);
  await expandPack(page); await expect(page.locator('#pack')).toBeVisible();
  expect(await page.locator('#emojiGrid').evaluate(n=>n.clientHeight)).toBeLessThan(collapsedHeight);
  await page.locator('#pack').fill('batch_pack'); await page.locator('#loadPack').click();
  await expect(page.locator('#pack')).toBeHidden(); await expect(page.locator('#packTitle')).toContainText('60');
  await expandPack(page); await page.locator('#pack').fill('test_pack'); await page.locator('#loadPack').click();
  await expect(page.locator('#pack')).toBeHidden(); await expandPack(page);
  await page.locator('#packHistory').selectOption('batch_pack'); await expect(page.locator('#packHistory')).toBeHidden();
  await expect(page.locator('.emoji-choice')).toHaveCount(24);
  await page.locator('.emoji-choice').first().click(); await expect(page.locator('#message .ql-editor .custom-emoji')).toHaveCount(1);
  await page.screenshot({path:'test-results/emoji-pack-collapsed.png'});
});
