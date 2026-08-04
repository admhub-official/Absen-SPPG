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

Deno.test("PWA has one stable registration owner", async () => {
  const index = await read("index.html");
  const config = await read("supabase-config.js");
  const bootstrap = await read("src/app/bootstrap.js");
  const runtime = await read("pwa-runtime.js");

  for (const [path, source] of [["index.html", index], ["supabase-config.js", config]]) {
    if (source.includes("serviceWorker.register")) {
      throw new Error(`${path} must not register the service worker directly`);
    }
  }
  if (!bootstrap.includes("pwa-runtime.js")) throw new Error("bootstrap must load the PWA runtime");
  if (!runtime.includes("serviceWorker.register('./sw.js'")) {
    throw new Error("PWA runtime must own the stable sw.js registration");
  }
});

Deno.test("responsive overrides are loaded only by bootstrap", async () => {
  const index = await read("index.html");
  const bootstrap = await read("src/app/bootstrap.js");
  if (index.includes("responsive-overrides.css") || index.includes("layout-enhancements.js")) {
    throw new Error("legacy index must not load modular layout assets directly");
  }
  for (const asset of ["responsive-overrides.css", "layout-enhancements.js"]) {
    if (!bootstrap.includes(asset)) throw new Error(`bootstrap missing ${asset}`);
  }
});
