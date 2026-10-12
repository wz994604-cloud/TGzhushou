export async function logoutCurrentAccount({ fetchImpl = fetch, onLoggedOut = () => {} } = {}) {
  const response = await fetchImpl('/auth/logout', { method: 'POST' });
  if (!response?.ok) throw new Error('退出当前账号失败，请稍后重试');
  await onLoggedOut();
}

export function authRecoveryMessage(error, miniApp) {
  if (miniApp && (error?.status === 401 || error?.status === 403)) return 'Telegram 身份验证失败，请从入口机器人重新打开。';
  if (error?.status === 401 || error?.status === 403 || error?.message === '未授权') return '登录状态已失效，请重新登录。';
  return `工作台加载失败：${error?.message || '未知错误'}`;
}

export function accountActionLabel(miniApp) {
  return miniApp ? '重新验证当前会话' : '退出当前账号';
}

export function showAuthScreen(elements, error, miniApp) {
  const denied = error?.status === 401 || error?.status === 403;
  elements.workspace.hidden = true;
  elements.locked.hidden = false;
  elements.locked.dataset.authMode = miniApp ? 'telegram' : 'browser';
  elements.loginForm.hidden = miniApp;
  elements.loginHint.hidden = miniApp;
  elements.telegramRecovery.hidden = !miniApp;
  elements.authRetry.hidden = !miniApp || denied;
  elements.loginTitle.textContent = miniApp
    ? (denied ? '无法验证当前会话' : '暂时连接不上工作台')
    : '登录管理后台';
  elements.loginIntro.textContent = miniApp
    ? (denied ? '请关闭当前小程序，从 Telegram 入口机器人重新打开活动助手。' : '请检查网络连接后重试。')
    : '使用管理员账号密码进入运营工作台';
  elements.authError.textContent = miniApp && denied ? '' : authRecoveryMessage(error, miniApp);
}
