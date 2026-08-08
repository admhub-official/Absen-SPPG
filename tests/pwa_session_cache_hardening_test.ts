const read = (path: string) => Deno.readTextFile(path);

Deno.test('logout revokes server session before clearing client state', async () => {
  const guard = await read('src/app/logout-session-guard.js');
  const config = await read('supabase-config.js');
  for (const marker of [
    "window.apiCall('logout', { token }, { force: true })",
    "localStorage.removeItem('auth_token')",
    "localStorage.removeItem('auth_user')",
    'window.clearApiResponseCache?.()',
    'sessionStorage.clear()',
    "event.stopImmediatePropagation()",
    "absen:session-changed",
  ]) {
    if (!guard.includes(marker)) throw new Error(`logout guard missing ${marker}`);
  }
  if (!config.includes("if (functionName === 'logout') return originalApiCall(functionName, payload);")) {
    throw new Error('logout must bypass device registration wrapper');
  }
  if (!config.includes('function resetDeviceContext()') || !config.includes('registeredDevice = null')) {
    throw new Error('logout/session end must clear cached registered device context');
  }
});

Deno.test('PWA release version has one canonical source', async () => {
  const release = await read('src/app/release-version.js');
  const bootstrap = await read('src/app/bootstrap.js');
  const runtime = await read('pwa-runtime.js');
  const sw = await read('sw.js');
  const config = await read('supabase-config.js');

  if (!release.includes("version = '26.11.53'")) throw new Error('release version mismatch');
  if (!release.includes("cacheName = 'absen-sppg-hadirly-v94'")) throw new Error('release cache mismatch');
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
  for (const required of [
    "'./src/app/http-only-session-bridge.js'",
    "'./src/app/logout-session-guard.js'",
    "'./src/app/pwa-update-safety.js'",
    "'./src/app/private-asset-policy.js'",
  ]) {
    if (!manifest.includes(required)) throw new Error(`PWA shell missing ${required}`);
  }

  const paths = [...manifest.matchAll(/'((?:\.\/)[^']+\.(?:js|css))'/g)]
    .map((match) => (match[1] ?? '').replace(/^\.\//, ''))
    .filter(Boolean);
  if (paths.length < 63) throw new Error(`unexpectedly small PWA asset manifest: ${paths.length}`);
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

Deno.test('PWA activation is deferred while user has unsaved form or signature work', async () => {
  const runtime = await read('pwa-runtime.js');
  const safety = await read('src/app/pwa-update-safety.js');
  for (const marker of [
    'HadirlyUpdateSafety?.isDirty?.()',
    'activateWhenSafe',
    'absen:pwa-safe-point',
    'pendingWorker',
  ]) {
    if (!runtime.includes(marker)) throw new Error(`PWA runtime missing ${marker}`);
  }
  for (const marker of ['dirtyInputs', 'dirtyCanvases', "contenteditable=\"true\"", 'markClean']) {
    if (!safety.includes(marker)) throw new Error(`update safety missing ${marker}`);
  }
  const updateFound = runtime.slice(runtime.indexOf("'updatefound'"), runtime.indexOf("navigator.serviceWorker?.addEventListener?.('controllerchange'"));
  if (updateFound.includes("postMessage('SKIP_WAITING')") && !updateFound.includes('activateWhenSafe')) {
    throw new Error('updatefound must not bypass safe activation guard');
  }
});

Deno.test('private signed storage assets use browser no-store fetch policy', async () => {
  const policy = await read('src/app/private-asset-policy.js');
  for (const marker of [
    "'/storage/v1/object/sign/'",
    "'/storage/v1/object/authenticated/'",
    "cache: 'no-store'",
    "referrerPolicy: 'no-referrer'",
    'URL.createObjectURL',
  ]) {
    if (!policy.includes(marker)) throw new Error(`private asset policy missing ${marker}`);
  }
  if (!policy.includes('window.open = function guardedWindowOpen')) throw new Error('programmatic private asset opens must be guarded');
});
