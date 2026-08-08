importScripts('./src/app/release-version.js', './src/app/pwa-shell-assets.js');

const RELEASE = self.HADIRLY_RELEASE;
const ASSETS = self.HADIRLY_PWA_ASSETS;
if (!RELEASE?.version || !RELEASE?.cacheName) throw new Error('Release manifest PWA tidak tersedia.');
if (!ASSETS?.styles?.length || !ASSETS?.scripts?.length) throw new Error('Asset manifest PWA tidak tersedia.');

const CACHE = RELEASE.cacheName;
const APP_VERSION = RELEASE.version;
const CANONICAL_ORIGIN = 'https://hadirly.org';
const LEGACY_HOSTS = new Set(['absen-sppg.pages.dev']);
const versioned = (path) => `${path}?v=${APP_VERSION}`;
const SHELL = [
  './',
  './index.html',
  './verify-id.html',
  './verify-contract.html',
  './manifest.webmanifest',
  './supabase-config.js',
  './src/app/release-version.js',
  './src/app/pwa-shell-assets.js',
  './src/app/navigation-state-guard.js',
  './src/app/session-request-abort.js',
  './src/app/session-context.js',
  './icons/app-icon.svg',
  './icons/app-icon-maskable.svg',
  './icons/hadirly-logo-horizontal.svg',
  versioned('./src/app/bootstrap.js'),
  ...ASSETS.styles.map(versioned),
  ...ASSETS.scripts.map(versioned)
];

function offlineAssetResponse(request) {
  const type = request.destination === 'style' || new URL(request.url).pathname.endsWith('.css')
    ? 'text/css; charset=utf-8'
    : 'application/javascript; charset=utf-8';
  return new Response('', {
    status: 503,
    statusText: 'Offline asset unavailable',
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store' }
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (key.startsWith('absen-sppg-') || key.startsWith('hadirly-')) && key !== CACHE)
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

  // Authentication/BFF traffic must always use the browser network stack directly.
  // Never let Cache Storage, navigation fallback, or offline behavior answer /api requests.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' && LEGACY_HOSTS.has(url.hostname.toLowerCase())) {
    const target = new URL(url.pathname + url.search + url.hash, CANONICAL_ORIGIN);
    event.respondWith(Response.redirect(target.href, 308));
    return;
  }

  if (request.mode === 'navigate') {
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

  const isCodeAsset = ['script', 'style', 'worker'].includes(request.destination) ||
    url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  if (isCodeAsset) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || offlineAssetResponse(request)))
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