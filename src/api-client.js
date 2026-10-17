// Every client uses the same Railway REST endpoints and account session cookie.
export function createWorkbenchApiClient({ getPublisherId = () => '', onUnauthorized = () => {}, onForbidden = () => {} } = {}) {
  const config = globalThis.__TGZ_API_CONFIG__ || {};
  const origin = String(config.railwayBase || '').replace(/\/$/, '');
  const base = origin.endsWith('/api') ? origin : `${origin}/api`;
  const headers = () => {
    const publisherId = getPublisherId();
    return publisherId ? { 'x-publisher-id': publisherId } : {};
  };
  async function request(path, options = {}) {
    const response = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
      ...options, credentials: 'same-origin',
    });
    if (response.status === 401) onUnauthorized(Object.assign(new Error('请登录账号'), { status: 401 }));
    return response;
  }
  async function api(path, method = 'GET', body) {
    const requestHeaders = headers();
    if (body && !(body instanceof FormData)) requestHeaders['content-type'] = 'application/json';
    const response = await request(path, {
      method, headers: requestHeaders,
      body: body instanceof FormData || body == null || typeof body === 'string' ? body : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 403 && result.error === '没有此机器人的操作权限') onForbidden(Object.assign(new Error(result.error), { status:403 }));
    if (!response.ok) throw Object.assign(new Error(result.error || `请求失败 (${response.status})`), { status: response.status });
    return result;
  }
  async function image(path) {
    const response = await request(path, { headers: headers() });
    if (!response.ok) throw Object.assign(new Error('图片加载失败'), { status: response.status });
    return response.blob();
  }
  return { api, image, headers };
}
