function runtimeConfig() {
  const config = globalThis.__TGZ_API_CONFIG__;
  return config && typeof config === 'object' ? config : {};
}

function joinBase(base, path) {
  const normalizedBase = String(base || '').replace(/\/$/, '');
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath;
}

export function createApiClient({ initData = '', getPublisherId = () => '', baseUrl, fallbackBaseUrl, mode } = {}) {
  const config = runtimeConfig();
  const primaryBase = baseUrl ?? (mode === 'serverless' ? config.serverlessBase : config.railwayBase) ?? config.baseUrl ?? '';
  const fallbackBase = fallbackBaseUrl ?? config.fallbackBaseUrl ?? '';
  const bases = [primaryBase, fallbackBase].filter((base, index, all) => all.indexOf(base) === index);
  const serverlessMode = mode === 'serverless';

  const headers = () => {
    const result = { 'x-telegram-init-data': initData };
    const publisherId = getPublisherId();
    if (publisherId) result['x-publisher-id'] = publisherId;
    return result;
  };

  async function serializeBody(body) {
    if (!(body instanceof FormData)) return body;
    const result = {};
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') { result[key] = value; continue; }
      const bytes = new Uint8Array(await value.arrayBuffer());
      let binary = '';
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
      result[key] = { name: value.name || key, mime: value.type || 'application/octet-stream', base64: btoa(binary) };
    }
    return result;
  }

  async function request(path, options = {}) {
    let lastError;
    for (const base of bases) {
      try {
        const useServerless = serverlessMode && base === primaryBase;
        const endpointPath = String(base || '').replace(/\/$/, '').endsWith('/api') ? '/api' : '/api/api';
        const response = useServerless
          ? await fetch(joinBase(base, endpointPath), {
            method: 'POST',
            headers: { ...(options.headers || {}), 'content-type': 'application/json' },
            body: JSON.stringify({
              route: path,
              method: options.method || 'GET',
              body: await serializeBody(options.body),
              publisherId: getPublisherId(),
            }),
          })
          : await fetch(joinBase(base, path), options);
        // Auth and validation errors belong to the selected backend. Only a
        // missing/unavailable route is eligible for the configured fallback.
        if (response.status < 500 && response.status !== 404) return response;
        if (base === bases.at(-1)) return response;
      } catch (error) {
        lastError = error;
        if (base === bases.at(-1)) throw error;
      }
    }
    throw lastError || new Error('API unavailable');
  }

  async function api(url, method = 'GET', body) {
    const requestHeaders = headers();
    if (body && !(body instanceof FormData)) requestHeaders['content-type'] = 'application/json';
    const response = await request(url, {
      method,
      headers: requestHeaders,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || result.description || `请求失败 (${response.status})`), { status: response.status, code: result.parameters?.code });
    return result;
  }

  async function image(url) {
    const response = await request(url, { headers: headers() });
    if (!response.ok) throw Object.assign(new Error('图片加载失败'), { status: response.status });
    if (serverlessMode && response.headers.get('content-type')?.includes('application/json')) {
      const result = await response.json();
      if (!result?.__binary || !result.base64) throw new Error('图片响应无效');
      const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0));
      return new Blob([bytes], { type: result.mime || 'application/octet-stream' });
    }
    return response.blob();
  }

  return { api, image, headers, bases };
}
