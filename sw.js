/* Service worker: lets the dashboard open even when Wi-Fi is down.
   Network first (so updates show up right away), cache as a fallback.
   Codeforces API calls are not cached here; the app caches those itself. */
const CACHE = 'cf-arcade-v13';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/util.js', 'js/api.js', 'js/stats.js', 'js/sound.js',
  'js/fx.js', 'js/charts.js', 'js/boards.js', 'js/live.js', 'js/radio.js', 'js/stopwatch.js', 'js/extras.js', 'js/team.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'codeforces.com') return;
  // Own files: always ask the server whether they changed (skip the browser's HTTP cache),
  // so a new version of the dashboard shows up on the next load.
  const own = url.origin === location.origin && e.request.mode !== 'navigate';
  e.respondWith(
    (own ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request)).then(res => {
      if (res.ok && (url.origin === location.origin || url.hostname.includes('fonts.g'))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
