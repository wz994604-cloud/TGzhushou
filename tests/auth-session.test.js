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

// The page must not mix Telegram recovery actions with browser credentials.
const { showAuthScreen } = await import('../src/auth-session.js');
function authElements() {
  return Object.fromEntries(['locked','workspace','loginForm','loginTitle','loginIntro','loginHint','authError','telegramRecovery','authRetry','closeSession'].map(id => [id, { hidden: false, textContent: '', dataset: {} }]));
}
test('Telegram auth failure hides password form and provides session recovery', () => {
  const elements = authElements();
  showAuthScreen(elements, { status: 401 }, true);
  assert.equal(elements.workspace.hidden, true);
  assert.equal(elements.locked.hidden, false);
  assert.equal(elements.loginForm.hidden, true);
  assert.equal(elements.loginHint.hidden, true);
  assert.equal(elements.telegramRecovery.hidden, false);
  assert.equal(elements.loginTitle.textContent, '无法验证当前会话');
});
test('browser login stays available without Telegram recovery instructions', () => {
  const elements = authElements();
  showAuthScreen(elements, { status: 401 }, false);
  assert.equal(elements.loginForm.hidden, false);
  assert.equal(elements.telegramRecovery.hidden, true);
  assert.equal(elements.loginTitle.textContent, '登录管理后台');
  assert.doesNotMatch(elements.authError.textContent, /Telegram/);
});
test('network failures offer retry without claiming Telegram credentials failed', () => {
  const elements = authElements();
  showAuthScreen(elements, new Error('网络中断'), true);
  assert.equal(elements.loginForm.hidden, true);
  assert.equal(elements.authRetry.hidden, false);
  assert.equal(elements.loginTitle.textContent, '暂时连接不上工作台');
  assert.match(elements.authError.textContent, /网络中断/);
});
