const read = (path: string) => Deno.readTextFile(path);

Deno.test("public pre-login flows bypass cookie session enforcement", async () => {
  const bridge = await read("src/app/http-only-session-bridge.js");
  const gateway = await read("supabase/functions/SessionGateway/index.ts");
  for (const marker of [
    "const PUBLIC_ABSEN_FUNCTIONS = new Set([",
    "'registerUser'",
    "'verifyRegistrationOtp'",
    "'requestResetPassword'",
    "'verifyResetPasswordOtp'",
    "'resetPassword'",
    "'resendConfirmationEmail'",
    "if (target === 'AbsenV2' && PUBLIC_ABSEN_FUNCTIONS.has(name))",
  ]) if (!bridge.includes(marker)) throw new Error(`browser public flow missing ${marker}`);
  for (const marker of [
    "const PUBLIC_ABSEN_FUNCTIONS = new Set([",
    '"registerUser"',
    '"verifyRegistrationOtp"',
    '"requestResetPassword"',
    '"verifyResetPasswordOtp"',
    '"resetPassword"',
    '"resendConfirmationEmail"',
    "const publicPreAuth = target === \"AbsenV2\" && PUBLIC_ABSEN_FUNCTIONS.has(functionNameOf(payload));",
    "const replacements = publicPreAuth ? new Map<string, string>() : await sessionForwardMap(payload, isServiceRequest(request));",
  ]) if (!gateway.includes(marker)) throw new Error(`gateway public flow missing ${marker}`);
});

Deno.test("browser persists only minimal non-sensitive auth identity", async () => {
  const bridge = await read("src/app/http-only-session-bridge.js");
  for (const marker of [
    "const SAFE_AUTH_USER_KEYS = new Set([",
    "'ID_User'", "'idUser'", "'Username'", "'username'", "'Email'", "'email'",
    "'Nama_Lengkap'", "'namaLengkap'", "'Role'", "'role'", "'SPPG'", "'sppg'",
    "'Jabatan_Divisi'", "'jabatanDivisi'", "'Status_Aktif'", "'statusAktif'",
    "'Wajah_Terdaftar'", "'URL_Foto_Profil'", "'urlFotoProfil'",
    "function sanitizePersistedUser(value)",
    "const nativeSetItem = storage.setItem.bind(storage);",
    "if (String(key) === 'auth_user')",
  ]) if (!bridge.includes(marker)) throw new Error(`auth_user storage hardening missing ${marker}`);
  for (const forbidden of ["'NIK'", "'Alamat'", "'Nomor_Rekening'", "'Gaji_Harian'", "'Password_Hash'", "'Face_Descriptor_JSON'"]) {
    const safeBlock = bridge.slice(bridge.indexOf("const SAFE_AUTH_USER_KEYS"), bridge.indexOf("function sanitizePersistedUser"));
    if (safeBlock.includes(forbidden)) throw new Error(`sensitive field must not be persisted in auth_user: ${forbidden}`);
  }
});

Deno.test("service worker bypasses same-origin BFF API completely", async () => {
  const sw = await read("sw.js");
  if (!sw.includes("if (url.pathname.startsWith('/api/')) return;")) {
    throw new Error("service worker must not intercept BFF /api requests");
  }
});
