const read = (path: string) => Deno.readTextFile(path);

Deno.test('logout revokes server session before clearing client state', async () => {
  const guard = await read('src/app/logout-session-guard.js');
  const config = await read('supabase-config.js');
  for (const marker of [
    "window.apiCall('logout', { token }, { force: true })",
    "localStorage.removeItem('auth_token')",
    "localStorage.removeItem('auth_user')",
    'window.clearApiResponseCache?.()',
    "event.stopImmediatePropagation()",
    "absen:session-changed",
  ]) {
    if (!guard.includes(marker)) throw new Error(`logout guard missing ${marker}`);
  }
  if (!config.includes("if (functionName === 'logout') return originalApiCall(functionName, payload);")) {
    throw new Error('logout must bypass device registration wrapper');
  }
});

Deno.test('PWA release version has one canonical source', async () => {
  const release = await read('src/app/release-version.js');
  const bootstrap = await read('src/app/bootstrap.js');
  const runtime = await read('pwa-runtime.js');
  const sw = await read('sw.js');
  const config = await read('supabase-config.js');

  if (!release.includes("version = '26.11.50'")) throw new Error('release version mismatch');
  if (!release.includes("cacheName = 'absen-sppg-hadirly-v91'")) throw new Error('release cache mismatch');
  for (const [name, source] of [['bootstrap', bootstrap], ['runtime', runtime]] as const) {
    if (!source.includes('HADIRLY_RELEASE?.version')) throw new Error(`${name} must read shared release version`);
  }
  if (!sw.includes("importScripts('./src/app/release-version.js', './src/app/pwa-shell-assets.js')")) {
    throw new Error('service worker must import shared release and asset manifests');
  }
  if (!config.includes("await import('./src/app/release-version.js')") || !config.includes("await import('./src/app/pwa-shell-assets.js')")) {
    throw new Error('bootstrap loader must hydrate shared release manifests');
  }
  if (/const VERSION\s*=\s*['\"]\d/.test(runtime)) throw new Error('pwa-runtime must not hardcode its own version');
});

Deno.test('PWA shell is the same manifest consumed by bootstrap and all entries exist', async () => {
  const manifest = await read('src/app/pwa-shell-assets.js');
  const bootstrap = await read('src/app/bootstrap.js');
  const sw = await read('sw.js');

  if (!bootstrap.includes('ASSETS.styles.map') || !bootstrap.includes('for (const path of ASSETS.scripts)')) {
    throw new Error('bootstrap must consume shared PWA asset manifest');
  }
  if (!sw.includes('...ASSETS.styles.map(versioned)') || !sw.includes('...ASSETS.scripts.map(versioned)')) {
    throw new Error('service worker must precache shared PWA asset manifest');
  }
  if (!manifest.includes("'./src/app/logout-session-guard.js'")) throw new Error('logout guard must be part of shell');

  const paths = [...manifest.matchAll(/'((?:\.\/)[^']+\.(?:js|css))'/g)]
    .map((match) => (match[1] ?? '').replace(/^\.\//, ''))
    .filter(Boolean);
  if (paths.length < 60) throw new Error(`unexpectedly small PWA asset manifest: ${paths.length}`);
  for (const path of paths) {
    try {
      const stat = await Deno.stat(path);
      if (!stat.isFile) throw new Error('not a file');
    } catch {
      throw new Error(`PWA manifest references missing asset: ${path}`);
    }
  }
});

Deno.test('service worker never serves index HTML as JS or CSS fallback', async () => {
  const sw = await read('sw.js');
  if (!sw.includes("if (request.mode === 'navigate')")) throw new Error('navigation strategy missing');
  if (!sw.includes("cached || caches.match('./index.html')")) throw new Error('navigation offline fallback missing');
  if (!sw.includes('offlineAssetResponse(request)')) throw new Error('code asset 503 fallback missing');
  if (!sw.includes("status: 503")) throw new Error('offline code asset must return 503');

  const codeBranch = sw.slice(sw.indexOf('if (isCodeAsset)'), sw.indexOf("event.respondWith(\n    caches.match(request)", sw.indexOf('if (isCodeAsset)')));
  if (codeBranch.includes("caches.match('./index.html')")) throw new Error('JS/CSS branch must never fall back to index.html');
});
