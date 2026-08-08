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
    "if (this === localStorage && String(key) === 'auth_user')",
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

Deno.test("root Cloudflare Workers build binds canonical BFF to hadirly api route", async () => {
  const wrangler = await read("wrangler.toml");
  for (const marker of [
    'name = "hadirly"',
    'main = "bff/cloudflare/worker.ts"',
    'workers_dev = false',
    'pattern = "hadirly.org/api/*"',
    'zone_name = "hadirly.org"',
    'HADIRLY_ORIGIN = "https://hadirly.org"',
    'SUPABASE_URL = "https://szwwpnbbsmjsbzzcecyj.supabase.co"',
    'ALLOW_LEGACY_EXCHANGE = "true"',
  ]) {
    if (!wrangler.includes(marker)) throw new Error(`root Cloudflare BFF route missing ${marker}`);
  }
});
