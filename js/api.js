/* Codeforces API client.
   Codeforces allows roughly one call every 2 seconds, so every request goes
   through a single queue. Live-contest calls can jump the queue. Successful
   responses are cached so the screen still has data when Wi-Fi drops. */
(function () {
  const BASE = 'https://codeforces.com/api/';
  const GAP_MS = 2100;
  const queue = [];
  let running = false;
  let lastCall = 0;

  CF.api = { online: true, lastError: null };

  function cacheKey(method, params) {
    return 'cache.' + method + '?' + new URLSearchParams(params).toString();
  }

  async function doFetch(method, params) {
    const url = BASE + method + '?' + new URLSearchParams(params).toString();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!json) throw new Error('HTTP ' + res.status);
      if (json.status !== 'OK') {
        const err = new Error(json.comment || 'Codeforces API error');
        err.cf = true;
        throw err;
      }
      return json.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      const wait = lastCall + GAP_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastCall = Date.now();
      try {
        const result = await doFetch(job.method, job.params);
        CF.api.online = true;
        CF.api.lastError = null;
        if (job.cache) CF.store.set(cacheKey(job.method, job.params), { t: Date.now(), r: result });
        job.resolve(result);
      } catch (e) {
        const limited = /limit exceeded/i.test(e.message);
        if (limited && job.tries < 3) {
          job.tries++;
          lastCall = Date.now() + 2000;
          queue.unshift(job);
          continue;
        }
        if (!e.cf) CF.api.online = false;
        CF.api.lastError = e.message;
        job.reject(e);
      }
    }
    running = false;
  }

  /* call(method, params, {cache, priority}) -> Promise<result> */
  CF.api.call = function (method, params, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const job = { method, params: params || {}, cache: !!opts.cache, tries: 0, resolve, reject };
      if (opts.priority) queue.unshift(job); else queue.push(job);
      pump();
    });
  };

  CF.api.cached = function (method, params) {
    const c = CF.store.get(cacheKey(method, params || {}), null);
    return c ? c.r : null;
  };
})();
