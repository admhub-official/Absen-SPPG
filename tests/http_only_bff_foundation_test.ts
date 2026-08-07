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

// Baseline captured by Engineering Quality #437. This list is intentionally explicit:
// adding a new browser auth_token consumer fails CI, while final cookie cutover must reduce it to zero.
const expectedLegacyConsumers = [
  "index.html",
  "security-operations-ui.js",
  "security-ops-client.js",
  "src/app/attendance-import.js",
  "src/app/attendance-location-flow.js",
  "src/app/config-center.js",
  "src/app/digital-id-card.js",
  "src/app/employment-contract-navigation.js",
  "src/app/employment-contracts.js",
  "src/app/in-app-confirm.js",
  "src/app/logout-session-guard.js",
  "src/app/notification-publisher.js",
  "src/app/operational-notifications.js",
  "src/app/profile-contract-identity.js",
  "src/app/profile-employment-editor.js",
  "src/app/super-admin-dashboard.js",
  "src/app/super-admin-settings-hub.js",
  "src/app/system-settings.js",
  "src/features/notifications/app-announcements.js",
  "src/features/payroll/payroll-history.js",
  "src/services/api-client.js",
  "src/services/attendance-correction-service.js",
  "src/services/domain-services.js",
  "src/services/operations-v2-service.js",
  "supabase-config.js",
].sort();

Deno.test("browser auth_token inventory is explicit until production cookie cutover", async () => {
  const actual = await authTokenConsumers();
  if (JSON.stringify(actual) !== JSON.stringify(expectedLegacyConsumers)) {
    throw new Error(`auth_token consumer inventory changed. expected=${JSON.stringify(expectedLegacyConsumers)} actual=${JSON.stringify(actual)}`);
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

Deno.test("BFF route configuration is same-origin and does not claim production activation", async () => {
  const wrangler = await read("bff/cloudflare/wrangler.toml");
  const status = JSON.parse(await read("bff/runtime-status.json"));
  for (const marker of [
    'pattern = "hadirly.org/api/*"',
    'zone_name = "hadirly.org"',
    'HADIRLY_ORIGIN = "https://hadirly.org"',
    'SESSION_MAX_AGE_SECONDS = "28800"',
    'ALLOW_LEGACY_EXCHANGE = "true"',
  ]) {
    if (!wrangler.includes(marker)) throw new Error(`Cloudflare BFF config missing ${marker}`);
  }
  if (status.productionEnabled !== false || status.mode !== "source-only") {
    throw new Error("BFF must remain source-only until hadirly.org /api is actually deployed and smoke-tested");
  }
  if (status.cookieName !== "__Host-hadirly_session" || status.sameSite !== "Strict") {
    throw new Error("runtime status cookie contract is inconsistent");
  }
});

Deno.test("final localStorage cutover gate becomes strict when production BFF is enabled", async () => {
  const status = JSON.parse(await read("bff/runtime-status.json"));
  const consumers = await authTokenConsumers();
  const index = await read("index.html");
  if (status.productionEnabled === true) {
    if (consumers.length) throw new Error(`production cookie mode forbids auth_token consumers: ${consumers.join(", ")}`);
    if (index.includes("localStorage.setItem('auth_token'") || index.includes('localStorage.setItem("auth_token"')) {
      throw new Error("production cookie mode forbids writing auth_token to localStorage");
    }
    if (index.includes("localStorage.getItem('auth_token'") || index.includes('localStorage.getItem("auth_token"')) {
      throw new Error("production cookie mode forbids reading auth_token from localStorage");
    }
  } else if (!consumers.length) {
    throw new Error("source-only BFF status is stale: browser token consumers are already gone");
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
