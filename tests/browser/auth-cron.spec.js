import { test, expect } from '@playwright/test';

test('browser login reaches bootstrap and cron requires its own secret', async ({ request }) => {
  const origin = 'http://127.0.0.1:8099';
  const login = await request.post('/auth/login', {
    headers:{origin}, data:{username:'admin',password:'test-password-123'}
  });
  expect(login.status()).toBe(200);
  const cookie = login.headers()['set-cookie'].split(';')[0];
  const bootstrap = await request.get('/api/bootstrap', {headers:{cookie}});
  expect(bootstrap.status()).toBe(200);
  expect((await bootstrap.json()).admin.id).toBe('123456');
  expect((await request.post('/api/cron/tick')).status()).toBe(401);
  expect((await request.post('/api/cron/tick', {headers:{authorization:'Bearer local-test-cron-secret'}})).status()).toBe(200);
});
