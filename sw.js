const CACHE = 'absen-sppg-hadirly-v63';
const APP_VERSION = '26.11.22';
const CANONICAL_ORIGIN = 'https://hadirly.org';
const LEGACY_HOSTS = new Set(['absen-sppg.pages.dev']);
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './supabase-config.js',
  './icons/app-icon.svg',
  './icons/app-icon-maskable.svg',
  './icons/hadirly-logo-horizontal.svg',
  `./src/app/bootstrap.js?v=${APP_VERSION}`
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) =>
            (key.startsWith('absen-sppg-') || key.startsWith('hadirly-')) && key !== CACHE
          )
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate' && LEGACY_HOSTS.has(url.hostname.toLowerCase())) {
    const target = new URL(url.pathname + url.search + url.hash, CANONICAL_ORIGIN);
    event.respondWith(Response.redirect(target.href, 308));
    return;
  }

  if (url.pathname.endsWith('/src/app/bootstrap.js')) {
    const fresh = new Request(`./src/app/bootstrap.js?v=${APP_VERSION}`, {
      cache: 'reload',
      credentials: 'same-origin'
    });
    event.respondWith(
      fetch(fresh, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(fresh, copy));
          }
          return response;
        })
        .catch(() => caches.match(fresh))
    );
    return;
  }

  const networkFirst = request.mode === 'navigate' ||
    ['script', 'style', 'worker'].includes(request.destination) ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css');

  if (networkFirst) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && ['image', 'font'].includes(request.destination)) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
