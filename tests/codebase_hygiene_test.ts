const read = (path: string) => Deno.readTextFile(path);

Deno.test("frontend has one modular bootstrap owner", async () => {
  const config = await read("supabase-config.js");
  const client = await read("security-ops-client.js");
  const bootstrap = await read("src/app/bootstrap.js");
  const configBootstrapImports = config.match(/import\(['"]\.\/src\/app\/bootstrap\.js/g) ?? [];
  if (configBootstrapImports.length !== 1) throw new Error(`supabase-config must start bootstrap exactly once; found ${configBootstrapImports.length}`);
  if (client.includes("src/app/bootstrap.js")) throw new Error("security-ops-client must not bootstrap the application");
  if (!bootstrap.includes("canonicalPath") || !bootstrap.includes("loadedAssets")) throw new Error("bootstrap must deduplicate versioned and unversioned assets");
});

Deno.test("legacy security loader was removed", async () => {
  const config = await read("supabase-config.js");
  if (config.includes("loadScript('./security-ops-client.js')")) throw new Error("legacy Security Operations loader is still present");
  if (config.includes("loadStyle('./security-operations-ui.css')")) throw new Error("legacy Security Operations stylesheet loader is still present");
});

Deno.test("security client is idempotent", async () => {
  const client = await read("security-ops-client.js");
  if (!client.includes("if (window.SecurityOpsClient) return")) throw new Error("security client must prevent duplicate global initialization");
});

Deno.test("pull requests use one consolidated quality workflow", async () => {
  const quality = await read(".github/workflows/quality.yml");
  const staging = await read(".github/workflows/staging-release.yml");
  if (!quality.includes("deno task ci")) throw new Error("quality workflow must run consolidated CI");
  if (staging.includes("pull_request:")) throw new Error("staging workflow must not duplicate PR checks");
  for (const obsolete of [".github/workflows/release-16-19.yml",".github/workflows/release-20-22.yml"]) {
    try { await Deno.stat(obsolete); throw new Error(`obsolete workflow still exists: ${obsolete}`); }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  }
});

Deno.test("operations edge functions use shared session authentication", async () => {
  const sharedAuth = await read("supabase/functions/_shared/auth.ts");
  for (const token of ["authenticateUserSession", "requireOperationalRole", "requireSuperAdminRole"]) if (!sharedAuth.includes(token)) throw new Error(`shared auth missing ${token}`);
  for (const path of ["supabase/functions/OperationsV2/index.ts","supabase/functions/WorkforceOps/index.ts","supabase/functions/PlatformOps/index.ts"]) {
    const source = await read(path);
    if (!source.includes("authenticateUserSession")) throw new Error(`${path} does not use shared authentication`);
    if (source.includes('from("Sessions").select')) throw new Error(`${path} still duplicates session authentication`);
  }
});

Deno.test("temporary frontend artifacts are removed", async () => {
  const bootstrap = await read("src/app/bootstrap.js");
  const apiClient = await read("src/services/api-client.js");
  const pwa = await read("pwa-runtime.js");
  for (const obsolete of ["sw-v22.js","src/app/mobile-compact-hotfix.js","src/styles/mobile-compact-hotfix.css"]) {
    try { await Deno.stat(obsolete); throw new Error(`obsolete temporary artifact still exists: ${obsolete}`); }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  }
  if (!bootstrap.includes("layout-enhancements.js") || !bootstrap.includes("responsive-overrides.css")) throw new Error("stable layout assets are not loaded");
  if (apiClient.includes("export const apiCall")) throw new Error("unused apiCall compatibility export still exists");
  if (!pwa.includes("./sw.js") || pwa.includes("sw-v22.js")) throw new Error("PWA runtime must use stable service worker entrypoint");
});
