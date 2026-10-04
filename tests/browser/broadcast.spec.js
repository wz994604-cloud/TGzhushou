import { test, expect } from '@playwright/test';
import { signedData, publisherToken } from '../helpers.js';

test('CSV players retain numeric Telegram IDs and names through broadcast API and delivery queue', async ({ request }) => {
  const headers = { 'x-telegram-init-data':signedData() };
  expect((await request.post('/api/publisher', { headers, data:{ token:publisherToken } })).ok()).toBeTruthy();
  const imported = await request.post('/api/players/import', { headers, multipart:{ file:{
    name:'players.csv', mimeType:'text/csv',
    buffer:Buffer.from('ID,昵称,telegram_id\r\n1,玩家甲,8547433574\r\n2,玩家乙,9876543210\r\n')
  } } });
  expect(imported.ok()).toBeTruthy();
  const created = await request.post('/api/broadcasts', { headers, data:{
    name:'私信字段映射回归', delta:{ ops:[{ insert:'模拟私信\n' }] }, buttons:[],
    playerIds:['8547433574','9876543210']
  } });
  expect(created.ok()).toBeTruthy();
  const broadcast = await created.json();
  expect(broadcast.total).toBe(2);
  await expect(async () => {
    const detail = await (await request.get(`/api/broadcasts/${broadcast.id}`, { headers })).json();
    expect(detail.deliveries.map(row => row.telegram_id).sort()).toEqual(['8547433574','9876543210']);
    expect(detail.deliveries.map(row => row.display_name).sort()).toEqual(['玩家乙','玩家甲']);
    expect(detail.deliveries.every(row => row.status === 'SUCCESS')).toBe(true);
  }).toPass({ timeout:8000 });
});
