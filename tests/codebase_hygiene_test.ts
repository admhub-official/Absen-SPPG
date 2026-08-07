const read = (path: string) => Deno.readTextFile(path);

Deno.test("frontend has one modular bootstrap owner", async () => {
  const config = await read("supabase-config.js");
  const client = await read("security-ops-client.js");
  const bootstrap = await read("src/app/bootstrap.js");
  const configBootstrapImports = config.match(/src\/app\/bootstrap\.js/g) ?? [];
  if (configBootstrapImports.length !== 1) throw new Error(`supabase-config must start bootstrap exactly once; found ${configBootstrapImports.length}`);
  if (client.includes("src/app/bootstrap.js")) throw new Error("security-ops-client must not bootstrap the application");
  if (!bootstrap.includes("canonicalPath") || !bootstrap.includes("loadedAssets")) throw new Error("bootstrap must deduplicate versioned and unversioned assets");
  if (!bootstrap.includes("HADIRLY_PWA_ASSETS")) throw new Error("bootstrap must consume the shared asset manifest");
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
    const duplicatesTokenLookup = source.includes('from("Sessions").select') && source.includes('.eq("Token"');
    if (duplicatesTokenLookup) throw new Error(`${path} still duplicates session authentication`);
  }
});

Deno.test("temporary frontend artifacts are removed", async () => {
  const assets = await read("src/app/pwa-shell-assets.js");
  const apiClient = await read("src/services/api-client.js");
  const pwa = await read("pwa-runtime.js");
  for (const obsolete of ["sw-v22.js","src/app/mobile-compact-hotfix.js","src/styles/mobile-compact-hotfix.css"]) {
    try { await Deno.stat(obsolete); throw new Error(`obsolete temporary artifact still exists: ${obsolete}`); }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  }
  if (!assets.includes("layout-enhancements.js") || !assets.includes("responsive-overrides.css")) throw new Error("stable layout assets are not loaded");
  if (apiClient.includes("export const apiCall")) throw new Error("unused apiCall compatibility export still exists");
  if (!pwa.includes("./sw.js") || pwa.includes("sw-v22.js")) throw new Error("PWA runtime must use stable service worker entrypoint");
});

Deno.test("database hardening protects operational tables and privileged RPCs", async () => {
  const migration = await read("supabase/migrations/20260805144500_security_hardening_exposed_tables_and_payroll_rpcs.sql");
  for (const table of [
    "Payroll_TTD_Massal_Job",
    "Payroll_TTD_Massal_Item",
    "Attendance_Import_Jobs",
    "Attendance_Name_Mappings",
    "Attendance_Import_Rows",
    "Attendance_Import_Role_Config",
    "Face_Attendance_Policy",
    "App_Notifications",
    "App_Notification_Read",
    "Push_Subscriptions"
  ]) {
    if (!migration.includes(`public.\"${table}\" enable row level security`)) {
      throw new Error(`RLS hardening missing for ${table}`);
    }
  }
  for (const routine of [
    "bulk_publish_payroll_tick",
    "invoke_bulk_publish_payroll",
    "import_payroll_2026_batch",
    "import_payroll_2026_compact",
    "import_weekly_payroll_draft",
    "enforce_face_attendance_policy"
  ]) {
    if (!migration.includes(`function public.${routine}`)) throw new Error(`RPC hardening missing for ${routine}`);
  }
  if (!migration.includes("from public, anon, authenticated")) {
    throw new Error("privileged RPC execute grants must be revoked from public API roles");
  }
});

Deno.test("Supabase deployment uses a production-only function allowlist", async () => {
  const deployment = await read("deploy-supabase.ps1");
  for (const required of [
    "AbsenCore",
    "AttendanceLocation",
    "Absen",
    "AbsenV2",
    "DeviceTrust",
    "SecurityOps",
    "ProductionReadiness",
    "AttendanceCorrections",
    "AttendanceImport",
    "OperationsV2",
    "WorkforceOps",
    "PlatformOps"
  ]) {
    if (!deployment.includes(`\"${required}\"`)) throw new Error(`production function missing from allowlist: ${required}`);
  }
  if (!deployment.includes("TemporaryFunctionPattern") || !deployment.includes("Source Edge Function tidak ditemukan")) {
    throw new Error("deployment must reject temporary functions and missing source directories");
  }
  const allowlistBlock = deployment.match(/\$FunctionNames\s*=\s*@\(([\s\S]*?)\n\)/)?.[1] ?? "";
  for (const forbidden of ["RunP", "VerifyPayroll", "PublishPayrollFinal", "RebuildPayroll", "TrimPublished", "PrepareLogo"] ) {
    if (allowlistBlock.includes(forbidden)) throw new Error(`temporary function leaked into production allowlist: ${forbidden}`);
  }
  const obsoleteBlock = deployment.match(/\$ObsoleteFunctions\s*=\s*@\(([\s\S]*?)\n\)/)?.[1] ?? "";
  for (const obsolete of ["AbsenLegacy", "AbsenProxy"]) {
    if (!obsoleteBlock.includes(`\"${obsolete}\"`)) throw new Error(`obsolete function missing from cleanup list: ${obsolete}`);
  }
});
