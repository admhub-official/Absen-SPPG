const read = (path: string) => Deno.readTextFile(path);

async function walkJsHtml(path: string, output: string[] = []): Promise<string[]> {
  for await (const entry of Deno.readDir(path)) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory) await walkJsHtml(child, output);
    else if (entry.isFile && /\.(?:js|html)$/.test(entry.name)) output.push(child.replace(/^\.\//, ""));
  }
  return output;
}

async function browserFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(".")) {
    if (entry.isFile && /\.(?:js|html)$/.test(entry.name)) files.push(entry.name);
  }
  await walkJsHtml("src", files);
  return files.sort();
}

async function authTokenConsumers(): Promise<string[]> {
  const found: string[] = [];
  for (const path of await browserFiles()) {
    const source = await read(path);
    if (source.includes("auth_token")) found.push(path);
  }
  return found.sort();
}

// Compatibility inventory while the inline legacy application is still being decomposed.
// Canonical production virtualizes the fixed marker in memory; no raw auth token is persisted.
const expectedCompatibilityConsumers = [
  "index.html",
  "src/app/attendance-import.js",
  "src/app/config-center.js",
  "src/app/digital-id-card.js",
  "src/app/employment-contract-navigation.js",
  "src/app/employment-contracts.js",
  "src/app/http-only-session-bridge.js",
  "src/app/in-app-confirm.js",
  "src/app/logout-session-guard.js",
  "src/app/navigation-state-guard.js",
  "src/app/notification-publisher.js",
  "src/app/operational-notifications.js",
  "src/app/profile-contract-identity.js",
  "src/app/profile-employment-editor.js",
  "src/app/super-admin-dashboard.js",
  "src/app/super-admin-settings-hub.js",
  "src/app/system-settings.js",
  "src/features/notifications/app-announcements.js",
  "src/features/payroll/payroll-history.js",
  "supabase-config.js",
].sort();

Deno.test("browser auth_token inventory is explicit during runtime-only marker compatibility phase", async () => {
  const actual = await authTokenConsumers();
  if (JSON.stringify(actual) !== JSON.stringify(expectedCompatibilityConsumers)) {
    throw new Error(`auth_token compatibility inventory changed. expected=${JSON.stringify(expectedCompatibilityConsumers)} actual=${JSON.stringify(actual)}`);
  }
});

Deno.test("modern service and security consumers use canonical session context", async () => {
  const context = await read("src/app/session-context.js");
  const bootstrap = await read("src/app/bootstrap.js");
  const sw = await read("sw.js");
  for (const marker of ["HadirlySessionContext", "function token()", "function user()", "function authenticated()"] ) {
    if (!context.includes(marker)) throw new Error(`session context missing marker: ${marker}`);
  }
  const bridgeImport = bootstrap.indexOf("import './http-only-session-bridge.js';");
  const contextImport = bootstrap.indexOf("import './session-context.js';");
  const navigationImport = bootstrap.indexOf("import './navigation-state-guard.js';");
  if (bridgeImport < 0 || contextImport < 0 || navigationImport < 0 || !(bridgeImport < contextImport && contextImport < navigationImport)) {
    throw new Error("canonical session context must initialize after HttpOnly bridge and before navigation/application modules");
  }
  if (!sw.includes("'./src/app/session-context.js'")) throw new Error("PWA shell must precache canonical session context");

  for (const path of [
    "security-operations-ui.js",
    "security-ops-client.js",
    "src/app/attendance-location-flow.js",
    "src/services/api-client.js",
    "src/services/attendance-correction-service.js",
    "src/services/domain-services.js",
    "src/services/operations-v2-service.js",
  ]) {
    const source = await read(path);
    if (source.includes("auth_token")) throw new Error(`modern session consumer must not read auth_token directly: ${path}`);
    if (!source.includes("HadirlySessionContext")) throw new Error(`modern session consumer must use canonical session context: ${path}`);
  }
});

Deno.test("BFF uses a __Host HttpOnly Secure Strict cookie and never browser storage", async () => {
  const source = await read("bff/cloudflare/worker.ts");
  for (const marker of [
    'const COOKIE_NAME = "__Host-hadirly_session"',
    "HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=",
    'const CSRF_HEADER = "X-Hadirly-CSRF"',
    'request.headers.get("origin")',
    'request.headers.get("referer")',
    'request.headers.get("sec-fetch-site")',
    '"Cache-Control": "no-store, max-age=0"',
    '"Content-Security-Policy": "default-src \'none\'; frame-ancestors \'none\'; base-uri \'none\'; form-action \'none\'"',
    '"/api/auth/login"',
    '"/api/auth/logout"',
    '"/api/auth/session"',
    '"/api/auth/exchange"',
    'path.startsWith("/api/functions/")',
    'canonicalAuthCall(env, "logout", { token }, id)',
    '"Set-Cookie": expiredCookieHeader()',
    'removeSessionTokenFields',
    'SESSION_TOKEN_IN_URL_FORBIDDEN',
    'target.endsWith("Core")',
    'target === "SessionGateway"',
  ]) {
    if (!source.includes(marker)) throw new Error(`BFF security contract missing marker: ${marker}`);
  }
  for (const forbidden of ["document.cookie", "localStorage", "sessionStorage", "console.log(", "console.error("]) {
    if (source.includes(forbidden)) throw new Error(`BFF must not expose or log session material: ${forbidden}`);
  }
});

Deno.test("Cloudflare Pages route exposes the BFF on canonical same-origin /api", async () => {
  const pages = await read("functions/api/[[path]].ts");
  const wrangler = await read("bff/cloudflare/wrangler.toml");
  const status = JSON.parse(await read("bff/runtime-status.json"));
  for (const marker of [
    'import worker from "../../bff/cloudflare/worker.ts"',
    'HADIRLY_ORIGIN: "https://hadirly.org"',
    'SUPABASE_URL: "https://szwwpnbbsmjsbzzcecyj.supabase.co"',
    'SESSION_MAX_AGE_SECONDS: "28800"',
    'ALLOW_LEGACY_EXCHANGE: "false"',
  ]) {
    if (!pages.includes(marker)) throw new Error(`Cloudflare Pages BFF route missing ${marker}`);
  }
  for (const marker of [
    'pattern = "hadirly.org/api/*"',
    'zone_name = "hadirly.org"',
    'HADIRLY_ORIGIN = "https://hadirly.org"',
    'SESSION_MAX_AGE_SECONDS = "28800"',
    'ALLOW_LEGACY_EXCHANGE = "false"',
  ]) {
    if (!wrangler.includes(marker)) throw new Error(`Cloudflare BFF config missing ${marker}`);
  }
  if (status.productionEnabled !== true || status.mode !== "cloudflare-pages-function") {
    throw new Error("runtime status must describe the canonical Pages Function cutover");
  }
  if (status.cookieName !== "__Host-hadirly_session" || status.sameSite !== "Strict") {
    throw new Error("runtime status cookie contract is inconsistent");
  }
  if (status.secretStorage !== "http-only-cookie" || status.compatibilityMarkerInLocalStorage !== false || status.compatibilityMarkerRuntimeOnly !== true) {
    throw new Error("runtime status must document HttpOnly secret storage plus runtime-only compatibility");
  }
});

Deno.test("canonical browser cutover keeps auth_token runtime-only and disables legacy exchange", async () => {
  const bridge = await read("src/app/http-only-session-bridge.js");
  const bootstrap = await read("src/app/bootstrap.js");
  const status = JSON.parse(await read("bff/runtime-status.json"));
  for (const marker of [
    "const canonicalOrigin = 'https://hadirly.org'",
    "const sessionMarker = '__HADIRLY_HTTP_ONLY_SESSION__'",
    "let virtualSessionAuthenticated = false",
    "function installBrowserStorageGuards()",
    "nativeRemoveItem.call(localStorage, 'auth_token')",
    "return virtualSessionAuthenticated ? sessionMarker : null",
    "runtimeMarkerOnly: true",
    "'/api/auth/login'",
    "'/api/auth/session'",
    "'/api/auth/logout'",
    "`/api/functions/${encodeURIComponent(target)}`",
    "restoreCookieSession",
    "productionRequired: true",
  ]) if (!bridge.includes(marker)) throw new Error(`HttpOnly bridge missing marker: ${marker}`);
  if (bridge.includes("/api/auth/exchange") || bridge.includes("exchangeLegacySession")) {
    throw new Error("browser bridge must not retain legacy bearer exchange after final cutover");
  }
  const abortImport = bootstrap.indexOf("import './session-request-abort.js';");
  const bridgeImport = bootstrap.indexOf("import './http-only-session-bridge.js';");
  const contextImport = bootstrap.indexOf("import './session-context.js';");
  const routerImport = bootstrap.indexOf("import { createRouter } from './router.js';");
  if (abortImport !== 0 || bridgeImport < 0 || contextImport < 0 || routerImport < 0 || !(abortImport < bridgeImport && bridgeImport < contextImport && contextImport < routerImport)) {
    throw new Error("bootstrap must initialize request abort, HttpOnly bridge, and session context before application modules");
  }
  if (status.productionEnabled !== true || status.compatibilityMarkerInLocalStorage !== false || status.compatibilityMarkerRuntimeOnly !== true || status.legacyExchangeEnabled !== false) {
    throw new Error("runtime status does not match final runtime-only marker contract");
  }
});

Deno.test("public registration and password recovery stay available before login", async () => {
  const bridge = await read("src/app/http-only-session-bridge.js");
  for (const fn of [
    'getPublicConfig',
    'getMasterData',
    'checkUsernameUnique',
    'registerUser',
    'verifyRegistrationOtp',
    'requestResetPassword',
    'requestResetPasswordByEmail',
    'verifyResetPasswordOtp',
    'resetPassword',
    'resendConfirmationEmail',
  ]) {
    if (!bridge.includes(`'${fn}'`)) throw new Error(`public pre-login allowlist missing ${fn}`);
  }
  if (!bridge.includes("publicUnauthenticatedFunctions.has(name)")) {
    throw new Error('canonical bridge must bypass cookie BFF for explicitly public pre-login functions');
  }
});

Deno.test("persistent auth_user storage excludes sensitive profile and payroll fields", async () => {
  const bridge = await read("src/app/http-only-session-bridge.js");
  for (const marker of [
    'function sanitizePersistentUser(value)',
    'function installBrowserStorageGuards()',
    "String(key) === 'auth_user'",
    "JSON.stringify(sanitizePersistentUser(JSON.parse(String(value))))",
    "localStorage.setItem('auth_user', JSON.stringify(sanitizePersistentUser(user)))",
  ]) {
    if (!bridge.includes(marker)) throw new Error(`auth_user storage guard missing marker: ${marker}`);
  }
  const allowlist = bridge.slice(bridge.indexOf('const persistentUserKeys'), bridge.indexOf('const persistentDeviceKeys'));
  for (const sensitive of ['NIK','Alamat','Nomor_Rekening','Atas_Nama_Rekening','Gaji_Harian','Tanggal_Lahir','No_Whatsapp']) {
    if (allowlist.includes(`'${sensitive}'`)) throw new Error(`sensitive persistent auth_user field must not be allowlisted: ${sensitive}`);
  }
});

Deno.test("session database and gateway contracts remain digest-only", async () => {
  const migration = await read("supabase/migrations/20260807220000_session_token_hash_at_rest_final.sql");
  const auth = await read("supabase/functions/_shared/auth.ts");
  const gateway = await read("supabase/functions/SessionGateway/index.ts");
  for (const marker of [
    '"Token" = "Token_Hash"',
    "Raw bearer tokens must never be persisted",
    "sessions_token_digest_at_rest_check",
  ]) if (!migration.includes(marker)) throw new Error(`digest-only migration contract missing ${marker}`);
  if (!auth.includes('.eq("Token_Hash", tokenHash)') || auth.includes('.eq("Token", token)')) {
    throw new Error("shared auth must remain Token_Hash-only");
  }
  if (!gateway.includes("SESSION_DIGEST_NOT_ACCEPTED") || !gateway.includes("isServiceRequest(request)")) {
    throw new Error("SessionGateway must keep rejecting stored digests as public bearer tokens");
  }
});

Deno.test("PWA does not cache API/auth responses and keeps code fallback safe", async () => {
  const sw = await read("sw.js");
  if (!sw.includes("fetch(request, { cache: 'no-store' })")) throw new Error("PWA navigation/code fetch must remain no-store aware");
  if (!sw.includes("if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;")) {
    throw new Error("service worker must bypass same-origin BFF/auth requests");
  }
  if (!sw.includes("offlineAssetResponse(request)")) throw new Error("PWA JS/CSS must retain non-HTML offline fallback");
  if (/isCodeAsset[\s\S]{0,1200}caches\.match\('\.\/index\.html'\)/.test(sw)) {
    throw new Error("JS/CSS must never fall back to index.html");
  }
});

Deno.test("obsolete Edge names are excluded from browser BFF and deployment allowlists", async () => {
  const worker = await read("bff/cloudflare/worker.ts");
  const deploy = await read("deploy-supabase.ps1");
  for (const obsolete of ["AbsenLegacy", "DigitalIdentityPrint"]) {
    if (!deploy.includes(`"${obsolete}"`)) throw new Error(`${obsolete} must remain explicitly classified obsolete`);
    const targetBlock = worker.slice(worker.indexOf("const PROXY_TARGETS"), worker.indexOf("const AUTH_FUNCTIONS"));
    if (targetBlock.includes(`"${obsolete}"`)) throw new Error(`${obsolete} must not be exposed by the BFF`);
  }
});
