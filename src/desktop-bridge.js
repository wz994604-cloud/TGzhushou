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
  if (/Mac/i.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`)) {
    document.body.classList.add('desktop-macos');
    const dragRegion = document.getElementById('desktopDragRegion');
    dragRegion?.removeAttribute('hidden');
    const workspace = document.getElementById('workspace');
    if (workspace) {
      const syncDragRegion = () => { dragRegion.hidden = !workspace.hidden; };
      new MutationObserver(syncDragRegion).observe(workspace, { attributes:true, attributeFilter:['hidden'] });
      syncDragRegion();
    }
  }
  return true;
}

export async function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅允许打开 HTTP(S) 链接');
  if (isDesktopClient && invokeTauri) return invokeDesktop('open_external', { url });
  window.open(url, '_blank', 'noopener,noreferrer');
}
