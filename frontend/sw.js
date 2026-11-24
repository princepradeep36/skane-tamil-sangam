// Skåne Tamil Sangam app service worker.
// It is deliberately small: pages, styles, scripts and every API call always come from the
// server, exactly as in the browser, so nothing can go stale after a deploy and live games,
// registration, payments and admin pages behave the same in the app. The only thing kept on
// the phone is a small "You're offline" page (and the app icon), shown when there is no
// internet at all. Bump VERSION if offline.html or the icons change.
const VERSION = 'sts-app-v1';
const OFFLINE_URL = '/offline.html';
const KEEP = [OFFLINE_URL, '/icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(KEEP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // The offline page's own icon is served from the phone when the network is down.
  if (req.method === 'GET' && KEEP.includes(new URL(req.url).pathname) && req.mode !== 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  // Only page loads are touched, and only to show the offline page when the network fails.
  // Everything else (API, uploads, CSS, JS, images) goes straight to the network untouched.
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return await fetch(req);
    } catch (e) {
      const cache = await caches.open(VERSION);
      return (await cache.match(OFFLINE_URL)) || Response.error();
    }
  })());
});
