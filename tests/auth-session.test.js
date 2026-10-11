import test from 'node:test';
import assert from 'node:assert/strict';
import { logoutCurrentAccount, authRecoveryMessage, accountActionLabel } from '../src/auth-session.js';

test('logoutCurrentAccount clears the current browser account and returns to login', async () => {
  const calls = [];
  let returnedToLogin = false;
  await logoutCurrentAccount({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true };
    },
    onLoggedOut: () => { returnedToLogin = true; },
  });
  assert.deepEqual(calls, [{ url: '/auth/logout', options: { method: 'POST' } }]);
  assert.equal(returnedToLogin, true);
});

test('logoutCurrentAccount surfaces logout failures without pretending the account ended', async () => {
  await assert.rejects(
    logoutCurrentAccount({ fetchImpl: async () => ({ ok: false, status: 500 }) }),
    /退出当前账号失败/,
  );
});

test('auth recovery distinguishes browser accounts from Telegram sessions', () => {
  assert.equal(authRecoveryMessage({ status: 401 }, false), '登录状态已失效，请重新登录。');
  assert.equal(authRecoveryMessage({ status: 401 }, true), 'Telegram 身份验证失败，请从入口机器人重新打开。');
  assert.equal(accountActionLabel(false), '退出当前账号');
  assert.equal(accountActionLabel(true), '重新验证当前会话');
});
