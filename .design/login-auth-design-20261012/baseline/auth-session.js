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
