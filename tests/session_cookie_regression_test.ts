const read = (path: string) => Deno.readTextFile(path);

Deno.test("public pre-login flows bypass cookie session enforcement", async () => {
  const bridge = await read("src/app/http-only-session-bridge.js");
  const gateway = await read("supabase/functions/SessionGateway/index.ts");

  for (const marker of [
    "const publicUnauthenticatedFunctions = new Set([",
    "'getPublicConfig'",
    "'getMasterData'",
    "'checkUsernameUnique'",
    "'registerUser'",
    "'verifyRegistrationOtp'",
    "'requestResetPassword'",
    "'requestResetPasswordByEmail'",
    "'verifyResetPasswordOtp'",
    "'resetPassword'",
    "'resendConfirmationEmail'",
    "if (target === 'AbsenV2' && publicUnauthenticatedFunctions.has(name)) return downstreamFetch(input, init);",
  ]) {
    if (!bridge.includes(marker)) throw new Error(`browser public flow missing ${marker}`);
  }

  for (const marker of [
    "const PUBLIC_UNAUTHENTICATED_ABSEN_FUNCTIONS = new Set([",
    '"getPublicConfig"',
    '"getMasterData"',
    '"checkUsernameUnique"',
    '"registerUser"',
    '"verifyRegistrationOtp"',
    '"requestResetPassword"',
    '"requestResetPasswordByEmail"',
    '"verifyResetPasswordOtp"',
    '"resetPassword"',
    '"resendConfirmationEmail"',
    "function isPublicUnauthenticatedPayload(target: string, payload: Record<string, unknown>): boolean",
    'return target === "AbsenV2" && PUBLIC_UNAUTHENTICATED_ABSEN_FUNCTIONS.has(functionNameOfPayload(payload));',
    "const replacements = isPublicUnauthenticatedPayload(target, payload)",
    "? new Map<string, string>()",
    ": await sessionForwardMap(payload, isServiceRequest(request));",
  ]) {
    if (!gateway.includes(marker)) throw new Error(`gateway public flow missing ${marker}`);
  }
});

Deno.test("browser persists only minimal non-sensitive auth identity", async () => {
  const bridge = await read("src/app/http-only-session-bridge.js");

  for (const marker of [
    "const persistentUserKeys = new Set([",
    "'ID_User','idUser'",
    "'Username','username'",
    "'Role','role'",
    "'Nama_Lengkap','namaLengkap','nama'",
    "'Email','email'",
    "'SPPG','sppg'",
    "'Jabatan_Divisi','jabatanDivisi','jabatan_divisi'",
    "'Status_Aktif','statusAktif'",
    "'URL_Foto_Profil','urlFotoProfil'",
    "'Wajah_Terdaftar'",
    "function sanitizePersistentUser(value)",
    "const nativeSetItem = Storage.prototype.setItem;",
    "if (this === localStorage && String(key) === 'auth_user'",
    "JSON.stringify(sanitizePersistentUser(JSON.parse(String(value))))",
  ]) {
    if (!bridge.includes(marker)) throw new Error(`auth_user storage hardening missing ${marker}`);
  }

  const safeBlock = bridge.slice(
    bridge.indexOf("const persistentUserKeys"),
    bridge.indexOf("function sanitizePersistentUser"),
  );
  for (const forbidden of [
    "'NIK'",
    "'Alamat'",
    "'Nomor_Rekening'",
    "'Gaji_Harian'",
    "'Password_Hash'",
    "'Face_Descriptor_JSON'",
  ]) {
    if (safeBlock.includes(forbidden)) {
      throw new Error(`sensitive field must not be persisted in auth_user: ${forbidden}`);
    }
  }
});

Deno.test("service worker bypasses same-origin BFF API completely", async () => {
  const sw = await read("sw.js");
  if (!sw.includes("if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;")) {
    throw new Error("service worker must not intercept BFF /api requests");
  }
});

Deno.test("root Cloudflare Workers build separates frontend from canonical BFF", async () => {
  const wrangler = await read("wrangler.toml");
  const rootWorker = await read("bff/cloudflare/root-worker.ts");
  for (const marker of [
    'name = "hadirly"',
    'main = "bff/cloudflare/root-worker.ts"',
    'workers_dev = false',
    'pattern = "hadirly.org/api/*"',
    'zone_name = "hadirly.org"',
    'HADIRLY_ORIGIN = "https://hadirly.org"',
    'STATIC_ORIGIN = "https://absen-sppg.pages.dev"',
    'SUPABASE_URL = "https://szwwpnbbsmjsbzzcecyj.supabase.co"',
    'ALLOW_LEGACY_EXCHANGE = "true"',
  ]) {
    if (!wrangler.includes(marker)) throw new Error(`root Cloudflare config missing ${marker}`);
  }
  for (const marker of [
    'import bffWorker from "./worker.ts";',
    'const DEFAULT_STATIC_ORIGIN = "https://absen-sppg.pages.dev";',
    'return normalized === "/api" || normalized.startsWith("/api/");',
    'if (isApiPath(url.pathname)) return bffWorker.fetch(request, env);',
    'return serveStatic(request, env);',
    'headers.delete("cookie");',
    'headers.delete("set-cookie");',
  ]) {
    if (!rootWorker.includes(marker)) throw new Error(`root Cloudflare router missing ${marker}`);
  }
});

Deno.test("invalid BFF GET routes recover to app while session GET and mutations stay protected", async () => {
  const worker = await read("bff/cloudflare/worker.ts");
  for (const marker of [
    'function isApiNavigation(_request: Request, path: string, method: string): boolean',
    'if (path === "/api/auth/session") return false;',
    'return path === "/api" || path.startsWith("/api/");',
    'if (isApiNavigation(request, path, method)) return redirectToApp(env, id);',
    'headers.set("Location", `${configuredOrigin(env)}/`)',
    'const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);',
    'const browserConfirmsSameOrigin = secFetchSite === "same-origin";',
    'if (!suppliedOrigin && !sameOriginReference(suppliedReferer, origin) && !browserConfirmsSameOrigin)',
    'if (request.headers.get(CSRF_HEADER) !== CSRF_VALUE) return "CSRF_CHECK_FAILED";',
  ]) {
    if (!worker.includes(marker)) throw new Error(`PWA BFF navigation/auth guard missing ${marker}`);
  }
});
