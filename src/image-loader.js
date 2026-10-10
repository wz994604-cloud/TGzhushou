// Cache blobs, not object URLs: each displayed image owns its short-lived URL.
export function createImageLoader(fetchBlob, limit = 96, concurrency = 4) {
  const cache = new Map(), pending = new Map(), queue = [];
  let active = 0;
  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift(); active++;
      Promise.resolve().then(() => fetchBlob(job.key)).then(blob => {
        cache.set(job.key, blob);
        while (cache.size > limit) cache.delete(cache.keys().next().value);
        job.resolve(blob);
      }, job.reject).finally(() => { active--; pending.delete(job.key); pump(); });
    }
  }
  return key => {
    if (cache.has(key)) { const blob = cache.get(key); cache.delete(key); cache.set(key, blob); return Promise.resolve(blob); }
    if (pending.has(key)) return pending.get(key);
    const promise = new Promise((resolve, reject) => queue.push({ key, resolve, reject }));
    pending.set(key, promise); pump(); return promise;
  };
}
