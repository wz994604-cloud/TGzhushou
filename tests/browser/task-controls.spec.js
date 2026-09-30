import { test, expect } from '@playwright/test';
import { signedData, publisherToken } from '../helpers.js';
import { renderDelta } from '../../server/format.js';

async function setup(request) {
  const headers = { 'x-telegram-init-data': signedData() };
  expect((await request.post('/api/publisher', { headers, data: { token: publisherToken } })).ok()).toBeTruthy();
  const target = await (await request.post('/api/targets', { headers, data: { reference: '@test_channel' } })).json();
  return { headers, payload: { name: '链接与任务测试', delta: { ops: [{ insert: '测试内容\n' }] }, buttons: [], targetIds: [target.id], schedule: { kind: 'MANUAL' } } };
}
async function open(page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.Telegram={WebApp:{initData:${JSON.stringify(signedData())},ready(){},expand(){}}};` }));
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
}

test('mobile text links: add, edit, remove, preserve emoji, persist and render entities', async ({ page, request }) => {
  await setup(request); await open(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.locator('#name').fill('文字链接测试');
  await page.locator('#editLink').click({ timeout: 3000 });
  await page.locator('#linkText').fill('领取福利');
  await page.locator('#linkUrl').fill('https://t.me/example/60');
  await page.screenshot({ path: 'test-results/text-link-dialog.png', fullPage: true });
  await page.locator('#saveLink').click();
  const link = page.locator('.ql-editor a');
  await expect(link).toHaveText('领取福利'); await expect(link).toHaveAttribute('href', 'https://t.me/example/60');
  await link.click(); await expect(page.locator('#linkText')).toHaveValue('领取福利');
  await page.locator('#linkText').fill('官方频道'); await page.locator('#linkUrl').fill('https://t.me/example');
  await page.locator('#saveLink').click(); await expect(link).toHaveText('官方频道');
  await link.click(); await page.locator('#linkUrl').fill('javascript:alert(1)'); await page.locator('#saveLink').click();
  await expect(page.locator('#linkError')).toContainText('https://');
  await page.locator('#linkUrl').fill('https://t.me/example'); await page.locator('#saveLink').click();
  await page.locator('[name=target]').first().check(); await page.locator('#save').click();
  await expect(page.locator('#toast')).toHaveText('已保存');
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('tgzhushou:draft:v1')));
  const task = await (await request.get(`/api/tasks/${draft.taskId}`, { headers: { 'x-telegram-init-data': signedData() } })).json();
  expect(renderDelta(JSON.parse(task.delta_json)).entities).toContainEqual({ type: 'text_link', offset: 0, length: 4, url: 'https://t.me/example' });
  await page.reload(); await expect(link).toHaveText('官方频道');
  await link.click(); await page.locator('#removeLink').click();
  await expect(link).toHaveCount(0); await expect(page.locator('.ql-editor')).toHaveText('官方频道');
  // Selection formatting must keep embeds and bold rather than replace them with plain text.
  await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem('tgzhushou:draft:v1'));
    draft.delta = { ops: [{ insert: { customEmoji: { id: '5432101234567890123', alt: '🔥' } }, attributes: { bold: true, link: 'https://t.me/example' } }, { insert: '专属', attributes: { bold: true, link: 'https://t.me/example' } }, { insert: '\n' }] };
    localStorage.setItem('tgzhushou:draft:v1', JSON.stringify(draft));
  });
  await page.reload(); await link.first().click(); await page.locator('#linkUrl').fill('https://t.me/updated'); await page.locator('#saveLink').click();
  await expect(page.locator('.ql-editor .custom-emoji')).toHaveCount(1);
  await expect(page.locator('.ql-editor strong')).toHaveCount(1);
  await expect(link).toHaveAttribute('href', 'https://t.me/updated');
  await link.click(); await page.locator('#removeLink').click(); await expect(page.locator('.ql-editor .custom-emoji')).toHaveCount(1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('daily and manual tasks restart, stopped edits stay stopped, deletion retains bindings', async ({ page, request }) => {
  const { headers, payload } = await setup(request);
  const task = await (await request.post('/api/tasks', { headers, data: { ...payload, schedule: { kind: 'DAILY', start: '22:00', end: '02:00', interval: 30 } } })).json();
  const status = action => request.post(`/api/tasks/${task.id}/status`, { headers, data: { action } });
  expect((await status('activate')).ok()).toBeTruthy(); await status('stop');
  const restarted = await status('activate'); expect(restarted.ok()).toBeTruthy();
  expect((await restarted.json()).next_at).toBeGreaterThanOrEqual(Date.now() - 1000);
  expect((await request.delete(`/api/tasks/${task.id}`, { headers })).status()).toBe(400);
  await status('stop');
  const edited = await request.put(`/api/tasks/${task.id}`, { headers, data: payload });
  expect(edited.ok()).toBeTruthy(); expect((await edited.json()).status).toBe('STOPPED');
  await open(page); await page.locator('[data-tab=tasks]').click();
  await page.locator(`[data-task="${task.id}"][data-action=activate]`).click();
  await expect(page.locator(`[data-send-task="${task.id}"]`)).toBeVisible();
  await page.screenshot({ path: 'test-results/task-controls.png', fullPage: true });
  const manual = await (await request.get(`/api/tasks/${task.id}`, { headers })).json();
  expect(manual.status).toBe('DRAFT'); expect(manual.next_at).toBeNull();
  await page.locator(`[data-edit="${task.id}"]`).click();
  await expect(page.locator('#editorTitle')).toHaveText(`编辑活动 #${task.id}`);
  await page.locator('[data-tab=tasks]').click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator(`[data-delete-task="${task.id}"]`).click();
  expect((await request.get(`/api/tasks/${task.id}`, { headers })).ok()).toBeTruthy();
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-delete-task="${task.id}"]`).click();
  await expect(page.locator(`[data-edit="${task.id}"]`)).toHaveCount(0);
  expect((await request.get(`/api/tasks/${task.id}`, { headers })).status()).toBe(404);
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('tgzhushou:draft:v1')));
  expect(draft.taskId).toBeNull();
  const bootstrap = await (await request.get('/api/bootstrap', { headers })).json();
  expect(bootstrap.publisher.id).toBe('222222'); expect(bootstrap.targets.map(t => t.id)).toContain(payload.targetIds[0]);
});

test('expired once-only task requires future time before restarting', async ({ request }) => {
  const { headers, payload } = await setup(request);
  const task = await (await request.post('/api/tasks', { headers, data: { ...payload, schedule: { kind: 'ONCE', at: Date.now() - 5000 } } })).json();
  await request.post(`/api/tasks/${task.id}/status`, { headers, data: { action: 'stop' } });
  const result = await request.post(`/api/tasks/${task.id}/status`, { headers, data: { action: 'activate' } });
  expect(result.status()).toBe(400); expect((await result.json()).error).toContain('发布时间');
  const edited = await request.put(`/api/tasks/${task.id}`, { headers, data: { ...payload, schedule: { kind: 'ONCE', at: Date.now() + 3600000 } } });
  expect(edited.ok()).toBeTruthy();
  const restarted = await request.post(`/api/tasks/${task.id}/status`, { headers, data: { action: 'activate' } });
  expect((await restarted.json()).status).toBe('ACTIVE');
  await request.post(`/api/tasks/${task.id}/status`, { headers, data: { action: 'stop' } });
});
