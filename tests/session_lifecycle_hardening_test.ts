const read = (path: string) => Deno.readTextFile(path);

Deno.test("shared session policy enforces one-hour idle and throttled activity touch", async () => {
  const policy = await read("supabase/functions/_shared/session-policy.ts");
  for (const marker of [
    'SESSION_IDLE_SETTING_KEY = "security.idle_session_expiry"',
    'SESSION_RUNTIME_SETTING_KEY = "security.session_idle_runtime"',
    "DEFAULT_IDLE_SECONDS = 60 * 60",
    "DEFAULT_TOUCH_INTERVAL_SECONDS = 5 * 60",
    'enforcementStartedAt: null',
    'throw new Error("SESSION_EXPIRED")',
    '.update({ Last_Activity_At:',
    '.eq("Token_Hash", tokenHash)',
  ]) {
    if (!policy.includes(marker)) throw new Error(`session policy missing ${marker}`);
  }
  if (policy.includes('console.log(') || policy.includes('console.error(')) {
    throw new Error("session policy must not log bearer/session material");
  }
});

Deno.test("shared modern auth remains hash-only and now enforces activity", async () => {
  const auth = await read("supabase/functions/_shared/auth.ts");
  for (const marker of [
    'from "./session-policy.ts"',
    '.select("Token_Hash,ID_User,Type,Expires_At,Last_Activity_At")',
    '.eq("Token_Hash", tokenHash)',
    "await enforceSessionActivity(db, session.data, tokenHash)",
  ]) {
    if (!auth.includes(marker)) throw new Error(`shared auth missing ${marker}`);
  }
  if (auth.includes('.eq("Token", token)') || auth.includes(".eq('Token', token)")) {
    throw new Error("shared modern auth must never restore raw Sessions.Token lookup");
  }
});

Deno.test("SessionGateway owns remaining legacy auth consumers and enforces idle", async () => {
  const gateway = await read("supabase/functions/SessionGateway/index.ts");
  for (const [alias, core] of [
    ["ConfigCenter", "ConfigCenterCore"],
    ["PayrollListPage", "PayrollListPageCore"],
    ["SppgLocationConfig", "SppgLocationConfigCore"],
    ["SystemSettings", "SystemSettingsCore"],
  ]) {
    if (!gateway.includes(`${alias}: "${core}"`)) throw new Error(`${alias} is not gateway-owned`);
  }
  for (const marker of [
    'enforceSessionActivity(db, row, lookupHash)',
    '"SESSION_DIGEST_NOT_ACCEPTED"',
    '"SESSION_EXPIRED"',
    'select("Token,Token_Hash,ID_User,ID_Device,Type,Expires_At,Last_Activity_At")',
  ]) {
    if (!gateway.includes(marker)) throw new Error(`gateway lifecycle contract missing ${marker}`);
  }
  if (/console\.(?:log|error)\([^\n]*(?:raw|tokenHash|storedToken)/i.test(gateway)) {
    throw new Error("gateway must not log raw tokens or stored session digests");
  }
});

Deno.test("legacy direct endpoints have JWT-only cores and gateway aliases", async () => {
  const deploy = await read("deploy-supabase.ps1");
  for (const name of ["ConfigCenter", "PayrollListPage", "SppgLocationConfig", "SystemSettings"]) {
    const core = `${name}Core`;
    const wrapper = await read(`supabase/functions/${core}/index.ts`);
    if (!wrapper.includes(`../${name}/index.ts`)) throw new Error(`${core} does not wrap ${name}`);
    if (!deploy.includes(`"${core}"`)) throw new Error(`${core} missing from internal deployment allowlist`);
    if (!deploy.includes(`"${name}"`)) throw new Error(`${name} missing from gateway aliases`);
  }
});

Deno.test("database cutover safely initializes idle state and revokes on password change", async () => {
  const migration = await read("supabase/migrations/20260807163000_session_lifecycle_hardening.sql");
  for (const marker of [
    "security.session_idle_runtime",
    "'idleSeconds', 3600",
    "'touchIntervalSeconds', 300",
    "'enforcementStartedAt', v_cutover",
    'SET "Last_Activity_At" = v_cutover',
    'WHERE "Expires_At" > v_cutover',
    'DELETE FROM public."Sessions"',
    "revoke_user_sessions_after_password_change",
    'AFTER UPDATE OF "Password_Hash", "Password_Salt"',
    "cleanup_expired_sessions",
    "hadirly-expired-session-cleanup",
    "17 * * * *",
  ]) {
    if (!migration.includes(marker)) throw new Error(`lifecycle migration missing ${marker}`);
  }
  if (/DELETE FROM public\."Sessions"[\s\S]{0,120}Last_Activity_At/.test(migration)) {
    throw new Error("migration must not bulk-delete live sessions based on pre-cutover activity timestamps");
  }
});

Deno.test("HttpOnly BFF cutover requires canonical same-origin Cloudflare runtime configuration", async () => {
  const status = JSON.parse(await read("bff/runtime-status.json"));
  const pagesRoute = await read("functions/api/[[path]].ts");

  if (
    status.productionEnabled !== true ||
    status.productionConfigured !== true ||
    status.mode !== "cloudflare-pages-function"
  ) {
    throw new Error("HttpOnly cookie cutover requires configured Cloudflare Pages Functions production mode");
  }
  if (status.productionOrigin !== "https://hadirly.org") {
    throw new Error("HttpOnly BFF production origin must remain canonical hadirly.org");
  }
  if (
    status.routeSource !== "functions/api/[[path]].ts" ||
    !pagesRoute.includes('import worker from "../../bff/cloudflare/worker.ts"')
  ) {
    throw new Error("same-origin /api route must remain backed by the hardened BFF worker");
  }
  if (
    status.cookieName !== "__Host-hadirly_session" ||
    status.sameSite !== "Strict" ||
    status.secretStorage !== "http-only-cookie"
  ) {
    throw new Error("HttpOnly BFF cookie security contract is inconsistent");
  }
  if (typeof status.deploymentVerified !== "boolean") {
    throw new Error("runtime verification state must remain explicit until an external smoke-test is recorded");
  }
});
