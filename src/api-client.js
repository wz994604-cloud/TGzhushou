export function createApiClient({ initData = '', getPublisherId = () => '' } = {}) {
  const headers = () => {
    const result = { 'x-telegram-init-data': initData };
    const publisherId = getPublisherId();
    if (publisherId) result['x-publisher-id'] = publisherId;
    return result;
  };
  async function api(url, method = 'GET', body) {
    const requestHeaders = headers();
    if (body && !(body instanceof FormData)) requestHeaders['content-type'] = 'application/json';
    const response = await fetch(`/api${url}`, { method, headers: requestHeaders,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || `请求失败 (${response.status})`), { status: response.status });
    return result;
  }
  async function image(url) {
    const response = await fetch('/api' + url, { headers: headers() });
    if (!response.ok) throw Object.assign(new Error('图片加载失败'), { status: response.status });
    return response.blob();
  }
  return { api, image, headers };
}
