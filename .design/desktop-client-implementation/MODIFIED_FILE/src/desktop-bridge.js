export const isDesktopClient = Boolean(window.__TAURI_INTERNALS__);

let invokeTauri = null;
if (isDesktopClient) {
  try {
    ({ invoke: invokeTauri } = await import('@tauri-apps/api/core'));
  } catch (error) {
    console.error('桌面桥接加载失败', error);
  }
}

export async function invokeDesktop(command, args = {}) {
  if (!invokeTauri) throw new Error('当前不是桌面客户端');
  return invokeTauri(command, args);
}

export async function initDesktopShell() {
  if (!isDesktopClient) return false;
  document.body.classList.add('desktop-client');
  document.getElementById('desktopTitlebar')?.removeAttribute('hidden');
  const minimize = document.querySelector('[data-window-action="minimize"]');
  const maximize = document.querySelector('[data-window-action="maximize"]');
  const close = document.querySelector('[data-window-action="close"]');
  minimize?.addEventListener('click', () => invokeDesktop('minimize_window'));
  maximize?.addEventListener('click', async () => {
    const maximized = await invokeDesktop('toggle_maximize');
    maximize.setAttribute('aria-label', maximized ? '还原窗口' : '最大化窗口');
    maximize.title = maximized ? '还原窗口' : '最大化窗口';
  });
  close?.addEventListener('click', () => invokeDesktop('close_to_tray'));
  document.querySelector('[data-window-action="about"]')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('desktop-about'));
  });
  return true;
}

export async function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅允许打开 HTTP(S) 链接');
  if (isDesktopClient && invokeTauri) return invokeDesktop('open_external', { url });
  window.open(url, '_blank', 'noopener,noreferrer');
}
