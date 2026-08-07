const read = (path: string) => Deno.readTextFile(path);

Deno.test("index keeps one application configuration entrypoint", async () => {
  const index = await read("index.html");
  const configReferences = index.match(/supabase-config\.js/g) ?? [];
  if (configReferences.length !== 1) {
    throw new Error(`index.html must reference supabase-config.js once; found ${configReferences.length}`);
  }

  for (const forbidden of [
    "sw-v22.js",
    "mobile-compact-hotfix.js",
    "mobile-compact-hotfix.css",
    "security-operations-ui.js",
    "src/app/bootstrap.js",
  ]) {
    if (index.includes(forbidden)) {
      throw new Error(`index.html must not load modular asset directly: ${forbidden}`);
    }
  }
});

Deno.test("PWA uses one implementation with a controlled legacy shim", async () => {
  const index = await read("index.html");
  const config = await read("supabase-config.js");
  const assets = await read("src/app/pwa-shell-assets.js");
  const runtime = await read("pwa-runtime.js");
  const legacyWorker = await read("service-worker.js");

  if (config.includes("serviceWorker.register")) {
    throw new Error("supabase-config.js must not register the service worker directly");
  }
  if (!assets.includes("'./pwa-runtime.js'")) {
    throw new Error("shared asset manifest must load the PWA runtime");
  }
  if (!runtime.includes("serviceWorker.register('./sw.js'")) {
    throw new Error("PWA runtime must own the stable sw.js registration");
  }

  const legacyRegistrations = index.match(/serviceWorker\.register\(['"]\.\/service-worker\.js['"]/g) ?? [];
  const allRegistrations = index.match(/serviceWorker\.register\(/g) ?? [];
  if (legacyRegistrations.length !== 1 || allRegistrations.length !== 1) {
    throw new Error("index.html may only keep the single transitional service-worker.js registration");
  }
  if (!legacyWorker.includes("importScripts('./sw.js')")) {
    throw new Error("legacy service-worker.js must delegate entirely to sw.js");
  }
  for (const forbidden of ["addEventListener('install'", "addEventListener('activate'", "addEventListener('fetch'"]) {
    if (legacyWorker.includes(forbidden)) {
      throw new Error(`legacy service-worker.js must not duplicate worker logic: ${forbidden}`);
    }
  }
});

Deno.test("responsive overrides are loaded only by shared bootstrap manifest", async () => {
  const index = await read("index.html");
  const assets = await read("src/app/pwa-shell-assets.js");
  if (index.includes("responsive-overrides.css") || index.includes("layout-enhancements.js")) {
    throw new Error("legacy index must not load modular layout assets directly");
  }
  for (const asset of ["responsive-overrides.css", "layout-enhancements.js"]) {
    if (!assets.includes(asset)) throw new Error(`shared PWA manifest missing ${asset}`);
  }
});
