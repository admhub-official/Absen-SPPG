const CACHE = 'absen-sppg-shell-v36';
const APP_VERSION = '26.10.2';
const SHELL = [
  './',
  './index.html',
  './supabase-config.js',
  './security-ops-client.js',
  `./src/app/bootstrap.js?v=${APP_VERSION}`,
  './src/styles/app-system.css',
  './src/styles/responsive-overrides.css',
  './src/styles/mobile-ui-refresh.css',
  './src/styles/payroll-history.css',
  './src/styles/app-announcements.css',
  './src/styles/notification-mobile.css',
  './src/features/notifications/app-announcements.js'
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
          .filter((key) => key.startsWith('absen-sppg-') && key !== CACHE)
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

  // Bootstrap lama pernah tersimpan dengan query versi lama. Selalu arahkan
  // permintaan apa pun untuk bootstrap ke versi aplikasi terbaru.
  if (url.pathname.endsWith('/src/app/bootstrap.js')) {
    const freshBootstrap = new Request(`./src/app/bootstrap.js?v=${APP_VERSION}`, {
      cache: 'reload',
      credentials: 'same-origin'
    });
    event.respondWith(
      fetch(freshBootstrap, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(freshBootstrap, copy));
          }
          return response;
        })
        .catch(() => caches.match(freshBootstrap))
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
