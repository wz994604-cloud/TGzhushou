// Successful results only; concurrent callers share one upstream request.
export function createAssetCache({ limit = 128, ttl = 3600000 } = {}) {
  const values = new Map(), pending = new Map();
  return async (key, load) => {
    const hit = values.get(key);
    if (hit && hit.expires > Date.now()) {
      values.delete(key); values.set(key, hit); return hit.value;
    }
    values.delete(key);
    if (pending.has(key)) return pending.get(key);
    const promise = Promise.resolve().then(load).then(value => {
      values.set(key, { value, expires: Date.now() + ttl });
      while (values.size > limit) values.delete(values.keys().next().value);
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, promise); return promise;
  };
}
