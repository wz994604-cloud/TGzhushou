export async function logoutCurrentAccount({ fetchImpl = fetch, onLoggedOut = () => {} } = {}) {
  const response = await fetchImpl('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response?.ok) throw new Error('退出当前账号失败，请稍后重试');
  await onLoggedOut();
}
export function authRecoveryMessage(error) {
  if (error?.status === 401) return '请登录账号；登录状态已失效时，请重新登录。';
  return `工作台加载失败：${error?.message || '请检查网络连接后重试'}`;
}
export function showAuthScreen(elements, error) {
  elements.workspace.hidden = true;
  elements.locked.hidden = false;
  elements.loginForm.hidden = false;
  elements.authRetry.hidden = error?.status === 401;
  elements.loginTitle.textContent = '登录管理后台';
  elements.loginIntro.textContent = '使用管理员账号密码进入运营工作台';
  elements.authError.textContent = authRecoveryMessage(error);
}
