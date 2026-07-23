// ============================================================
// EDGE FUNCTION: api  —  BATCH 1: FONDASI + AUTH
// Sistem Absensi Multi-User — Backend Supabase Edge Function
// ============================================================

// @deno-types="npm:@types/node"
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function okResult(result: unknown): Response {
  return jsonResponse({ success: true, result });
}

function errResult(message: string, status = 200): Response {
  return jsonResponse({ success: false, error: message }, status);
}

class ApiError extends Error {}

const CONFIG = {
  FACE_THRESHOLD: 0.70,
  SESSION_DURATION_SECONDS: 28800,
  RESET_TOKEN_DURATION_MS: 15 * 60 * 1000,
  OTP_DURATION_MS: 10 * 60 * 1000, // Kode OTP berlaku 10 menit
  OTP_MAX_PERCOBAAN: 5,
  RESEND_OTP_BASE_COOLDOWN_SECONDS: 120, // Cooldown awal kirim ulang: 120 detik
  RESEND_OTP_MAX_PER_DAY: 3, // Maksimal kirim ulang per user per hari
  PASSWORD_GAGAL_TAMPIL_RESET: 3, // Ke-3x salah password -> tampilkan tombol reset
  PASSWORD_GAGAL_BEKUKAN_AKUN: 5, // Ke-5x salah password -> akun dibekukan
};

const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";

const RADIUS_ABSEN_METER = 70;

const SPPG_LOCATIONS: Record<string, { lat: number; lng: number }> = {
  DARMARAJA: { lat: -6.9186993373214465, lng: 108.07174565889278 },
  CISITU: { lat: -6.889491, lng: 108.044861 },
  TANJUNGMEDAR: { lat: -6.9186993373214465, lng: 108.07174565889278 },
  CIAMIS: { lat: -6.9186993373214465, lng: 108.07174565889278 },
  PAKUALAM: { lat: -6.9186993373214465, lng: 108.07174565889278 },
  CIAWI: { lat: -6.9186993373214465, lng: 108.07174565889278 },
  "CINTA JAYA": { lat: -6.9186993373214465, lng: 108.07174565889278 },
  KIRISIK: { lat: -6.9186993373214465, lng: 108.07174565889278 },
};

const LOGIN_RATE_LIMIT = { MAX_ATTEMPTS: 5, WINDOW_SECONDS: 300, BLOCK_SECONDS: 300 };
const RESET_RATE_LIMIT = { MAX_ATTEMPTS: 5, WINDOW_SECONDS: 300, BLOCK_SECONDS: 900 };

function toDateStr(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().split("T")[0];
  const s = String(value);
  return s.split("T")[0].split(" ")[0];
}

function toJakartaTime(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(/\./g, ":");
}

function hitungJarakMeter(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function validasiLokasiSppg(
  sppgUser: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
): { valid: boolean; jarak: number | null; alasan?: string } {
  const titik = SPPG_LOCATIONS[sppgUser];
  if (!titik) return { valid: true, jarak: null, alasan: "SPPG_BELUM_DIATUR" };
  if (lat == null || lng == null) return { valid: false, jarak: null, alasan: "LOKASI_TIDAK_TERSEDIA" };
  const jarak = hitungJarakMeter(titik.lat, titik.lng, lat, lng);
  return { valid: jarak <= RADIUS_ABSEN_METER, jarak: Math.round(jarak) };
}

function normalizeRole(role: string | undefined): string {
  return String(role || "").trim().toUpperCase().replace(/_/g, " ");
}

function isSuperAdmin(role: string | undefined): boolean {
  return normalizeRole(role) === "SUPER ADMIN";
}

function isAdminRole(role: string | undefined): boolean {
  const normalized = normalizeRole(role);
  return normalized === "ADMIN" || normalized === "SUPER ADMIN";
}

function canManageOperations(role: string | undefined): boolean {
  const normalized = normalizeRole(role);
  return normalized === "ADMIN" || normalized === "SUPER ADMIN" || normalized === "AKUNTAN";
}

let _sppgYayasanCache: Record<string, string> | null = null;
async function getSppgYayasanMap(): Promise<Record<string, string>> {
  if (_sppgYayasanCache) return _sppgYayasanCache;
  const { data } = await supabase.from("Master_SPPG").select("Nama_SPPG, Yayasan");
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { if (r.Nama_SPPG) map[r.Nama_SPPG] = r.Yayasan || ""; });
  _sppgYayasanCache = map;
  return map;
}

async function getAksesEmailSppgList(email: string): Promise<string[]> {
  if (!email) return [];
  const { data } = await supabase.from("Akses_Email").select("SPPG, Aktif").ilike("Email", email);
  return (data || []).filter((r: any) => isActive(r.Aktif)).map((r: any) => r.SPPG).filter(Boolean);
}

function isActive(status: unknown): boolean {
  return status === true || status === "TRUE" || status === 1 || status === "1" || status === "true";
}

function generateId(prefix: string): string {
  return prefix + "_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
}

function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + "_" + Date.now();
}

async function selectAllRows(
  table: string,
  columns = "*",
  applyFilters: (query: any) => any = (query) => query,
): Promise<any[]> {
  const pageSize = 1000;
  const firstQuery = applyFilters(supabase.from(table).select(columns, { count: "exact" })).range(0, pageSize - 1);
  const { data: firstPage, error: firstError, count } = await firstQuery;
  if (firstError) throw new Error(`Gagal mengambil data ${table}: ${firstError.message}`);
  const rows: any[] = [...(firstPage || [])];
  const total = count ?? rows.length;
  if (total <= pageSize) return rows;

  const remainingQueries: Array<PromiseLike<any>> = [];
  for (let from = pageSize; from < total; from += pageSize) {
    remainingQueries.push(
      applyFilters(supabase.from(table).select(columns)).range(from, Math.min(from + pageSize - 1, total - 1)),
    );
  }
  const remainingPages = await Promise.all(remainingQueries);
  remainingPages.forEach(({ data, error }) => {
    if (error) throw new Error(`Gagal mengambil data ${table}: ${error.message}`);
    rows.push(...(data || []));
  });
  return rows;
}

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function buildOtpEmailHtml(namaLengkap: string, kodeOtp: string, tujuan: "REGISTRASI" | "RESET" = "REGISTRASI"): string {
  const judulPesan = tujuan === "RESET"
    ? "Gunakan kode verifikasi di bawah ini untuk mereset password akun Anda:"
    : "Terima kasih telah mendaftar. Gunakan kode verifikasi di bawah ini untuk mengaktifkan akun Anda:";
  return `
<div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <tr>
      <td style="background:#2563eb;padding:24px 32px;">
        <span style="color:#ffffff;font-size:18px;font-weight:700;">Sistem Absensi SPPG</span>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <p style="margin:0 0 8px 0;font-size:15px;color:#0f172a;">Halo, ${namaLengkap || ""}</p>
        <p style="margin:0 0 24px 0;font-size:14px;color:#475569;line-height:1.6;">
          ${judulPesan}
        </p>
        <div style="text-align:center;margin-bottom:24px;">
          <div style="display:inline-block;background:#eff6ff;border:2px dashed #2563eb;color:#2563eb;font-size:32px;font-weight:800;letter-spacing:8px;padding:16px 32px;border-radius:8px;">
            ${kodeOtp}
          </div>
        </div>
        <p style="margin:0 0 4px 0;font-size:13px;color:#475569;">⏱ Kode berlaku selama <strong>10 menit</strong>.</p>
        <p style="margin:0 0 24px 0;font-size:13px;color:#475569;">
          Masukkan kode ini di halaman verifikasi pada aplikasi. Jangan bagikan kode ini kepada siapa pun.
        </p>
        <p style="margin:0 0 24px 0;font-size:13px;color:#475569;">
          Jika Anda tidak mendaftar, abaikan email ini.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="margin:0;font-size:11px;color:#94a3b8;">
          Email ini dikirim otomatis oleh Sistem Absensi SPPG. Mohon tidak membalas email ini.
        </p>
      </td>
    </tr>
  </table>
</div>`;
}

async function sendOtpEmail(email: string, namaLengkap: string, kodeOtp: string, tujuan: "REGISTRASI" | "RESET" = "REGISTRASI"): Promise<void> {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    throw new Error("Konfigurasi email server belum diatur (GMAIL_USER / GMAIL_APP_PASSWORD kosong).");
  }
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: {
        username: GMAIL_USER,
        password: GMAIL_APP_PASSWORD,
      },
    },
  });

  try {
    await client.send({
      from: `Sistem Absensi SPPG <${GMAIL_USER}>`,
      to: email,
      subject: tujuan === "RESET" ? `Kode Reset Password Anda: ${kodeOtp}` : `Kode Verifikasi Anda: ${kodeOtp}`,
      html: buildOtpEmailHtml(namaLengkap, kodeOtp, tujuan),
    });
  } finally {
    await client.close();
  }
}

async function generateAndSendOtp(
  email: string,
  idUser: string,
  namaLengkap: string,
  tujuan: "REGISTRASI" | "RESET" = "REGISTRASI",
  preserveResendState = false,
): Promise<void> {
  const kodeOtp = generateOtpCode();
  const expiresAt = new Date(Date.now() + CONFIG.OTP_DURATION_MS).toISOString();

  const payload: Record<string, unknown> = {
    Email: email.toLowerCase(),
    Kode_OTP: kodeOtp,
    ID_User: idUser,
    Percobaan_Gagal: 0,
    Expires_At: expiresAt,
    Tujuan: tujuan,
  };

  if (!preserveResendState) {
    payload.Resend_Count = 0;
    payload.Next_Resend_At = new Date(Date.now() + CONFIG.RESEND_OTP_BASE_COOLDOWN_SECONDS * 1000).toISOString();
  }

  const { error } = await supabase.from("Email_OTP").upsert(payload);
  if (error) throw new Error("Gagal menyimpan kode OTP: " + error.message);

  await sendOtpEmail(email, namaLengkap, kodeOtp, tujuan);
}

function generateIdCardUnik(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result.toUpperCase();
}

const PBKDF2_ITERATIONS = 10000;
const PBKDF2_KEYLEN_BITS = 256;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function pbkdf2Sha256(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_KEYLEN_BITS,
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const derived = await pbkdf2Sha256(password, salt);
  return "v2$" + derived;
}

async function hashPasswordLegacySha256(password: string, salt: string): Promise<string> {
  let hash = password + salt;
  for (let i = 0; i < 1000; i++) {
    const enc = new TextEncoder().encode(hash);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    hash = bytesToHex(new Uint8Array(digest));
  }
  return hash;
}

async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  if (typeof hash === "string" && hash.startsWith("v2$")) {
    return (await hashPassword(password, salt)) === hash;
  }
  return (await hashPasswordLegacySha256(password, salt)) === hash;
}

function isLegacyPasswordHash(hash: string): boolean {
  return !(typeof hash === "string" && hash.startsWith("v2$"));
}

function generateSalt(): string {
  return crypto.randomUUID().replace(/-/g, "").substring(0, 16);
}

interface SessionData {
  type: "user" | "device";
  idUser?: string;
  idDevice?: string;
  username?: string;
  role?: string;
  nama?: string;
  lokasi?: string;
}

async function saveSession(token: string, data: SessionData): Promise<void> {
  const expiresAt = new Date(Date.now() + CONFIG.SESSION_DURATION_SECONDS * 1000).toISOString();
  const { error } = await supabase.from("Sessions").insert({
    Token: token,
    Type: data.type,
    ID_User: data.idUser ?? null,
    ID_Device: data.idDevice ?? null,
    Username: data.username ?? null,
    Role: data.role ?? null,
    Nama: data.nama ?? null,
    Lokasi: data.lokasi ?? null,
    Expires_At: expiresAt,
  });
  if (error) throw new Error("Gagal menyimpan sesi: " + error.message);
}

async function getSession(token: string): Promise<SessionData | null> {
  if (!token) return null;
  const { data, error } = await supabase.from("Sessions").select("*").eq("Token", token).maybeSingle();
  if (error || !data) return null;
  if (new Date(data.Expires_At).getTime() < Date.now()) {
    await removeSession(token);
    return null;
  }
  return {
    type: data.Type,
    idUser: data.ID_User,
    idDevice: data.ID_Device,
    username: data.Username,
    role: data.Role,
    nama: data.Nama,
    lokasi: data.Lokasi,
  };
}

async function removeSession(token: string): Promise<void> {
  if (!token) return;
  await supabase.from("Sessions").delete().eq("Token", token);
}

async function validateSession(token: string): Promise<SessionData> {
  const session = await getSession(token);
  if (!session) throw new ApiError("SESI_HABIS");

  if (session.type === "user") {
    const { data: user } = await supabase
      .from("Users")
      .select("Status_Aktif")
      .eq("ID_User", session.idUser)
      .maybeSingle();
    if (!user || !isActive(user.Status_Aktif)) {
      await removeSession(token);
      throw new ApiError("AKUN_NONAKTIF");
    }
  } else if (session.type === "device") {
    const { data: device } = await supabase
      .from("Device_Absen")
      .select("Status_Aktif")
      .eq("ID_Device", session.idDevice)
      .maybeSingle();
    if (!device || !isActive(device.Status_Aktif)) {
      await removeSession(token);
      throw new ApiError("DEVICE_NONAKTIF");
    }
  }

  return session;
}

async function checkRateLimit(key: string, maxAttempts: number, blockMessage: string): Promise<void> {
  const { data } = await supabase.from("Rate_Limits").select("*").eq("Key", key).maybeSingle();
  if (!data) return;
  if (new Date(data.Expires_At).getTime() < Date.now()) return;
  if (data.Count >= maxAttempts) {
    throw new ApiError(blockMessage);
  }
}

async function recordFailure(key: string, maxAttempts: number, windowSeconds: number, blockSeconds: number): Promise<void> {
  const { data } = await supabase.from("Rate_Limits").select("*").eq("Key", key).maybeSingle();
  let count = 1;
  const now = Date.now();
  if (data && new Date(data.Expires_At).getTime() >= now) {
    count = (data.Count || 0) + 1;
  }
  const ttlSeconds = count >= maxAttempts ? blockSeconds : windowSeconds;
  const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();
  await supabase.from("Rate_Limits").upsert({ Key: key, Count: count, Expires_At: expiresAt });
}

async function clearRateLimit(key: string): Promise<void> {
  await supabase.from("Rate_Limits").delete().eq("Key", key);
}

function loginRateLimitKey(username: string): string {
  return "LOGIN_ATTEMPT_" + String(username || "").toLowerCase();
}

function resetRateLimitKey(username: string): string {
  return "RESET_ATTEMPT_" + String(username || "").toLowerCase();
}

async function logAudit(jenisAktivitas: string, detail: unknown, idUserPelaku: string | null): Promise<void> {
  try {
    const detailObj =
      detail !== null && typeof detail === "object" ? detail : { raw: String(detail) };
    await supabase.from("Audit_Log").insert({
      ID_Log: generateId("LOG"),
      Waktu: new Date().toISOString(),
      ID_User_Pelaku: idUserPelaku || "SYSTEM",
      Jenis_Aktivitas: jenisAktivitas,
      Detail: detailObj,
      IP_Address: "N/A",
    });
  } catch (e) {
    console.error("Audit log failed:", e);
  }
}

async function isEmailConfirmed(email: string): Promise<boolean> {
  if (!email) return true; // User tanpa email (mis. akun lama) tidak diblokir
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1, email: email } as any);
    if (error) {
      console.error("Gagal cek status verifikasi email:", error.message);
      return true; // Fail-open: jangan blokir login karena error teknis pengecekan
    }
    const authUser = data?.users?.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
    if (!authUser) return true; // Tidak ada entry auth (mis. akun lama sebelum fitur ini) → tidak diblokir
    return !!authUser.email_confirmed_at;
  } catch (e) {
    console.error("Gagal cek status verifikasi email (exception):", e);
    return true;
  }
}

function sanitizeUser(user: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  Object.keys(user).forEach((k) => {
    if (
      k !== "Password_Hash" &&
      k !== "Password_Salt" &&
      k !== "Token_Reset_Password" &&
      k !== "Percobaan_Password_Gagal"
    ) {
      safe[k] = user[k];
    }
  });
  return safe;
}

async function login(data: { username?: string; email?: string; password?: string }): Promise<unknown> {
  const emailOrUsername = String(data?.email || data?.username || "").toLowerCase();
  const password = data?.password || "";

  await checkRateLimit(
    loginRateLimitKey(emailOrUsername),
    LOGIN_RATE_LIMIT.MAX_ATTEMPTS,
    `Terlalu banyak percobaan login gagal. Coba lagi dalam ${Math.round(LOGIN_RATE_LIMIT.BLOCK_SECONDS / 60)} menit.`,
  );

  // Login USER (karyawan/admin/akuntan) sekarang memakai EMAIL, bukan username
  const { data: user } = await supabase
    .from("Users")
    .select("*")
    .ilike("Email", emailOrUsername)
    .maybeSingle();

  if (user) {
    if (user.Akun_Dibekukan) {
      await logAudit("LOGIN_GAGAL", { email: emailOrUsername, reason: "Akun dibekukan" }, user.ID_User);
      throw new ApiError("AKUN_DIBEKUKAN::Akun Anda dibekukan karena 5x salah memasukkan password. Silakan hubungi Admin.");
    }

    if (!isActive(user.Status_Aktif)) {
      await logAudit("LOGIN_GAGAL", { email: emailOrUsername, reason: "Akun tidak aktif / belum verifikasi email" }, null);
      throw new ApiError("EMAIL_BELUM_VERIFIKASI::Akun belum aktif. Pastikan email sudah diverifikasi dengan kode OTP, lalu coba lagi.");
    }

    const valid = await verifyPassword(password, user.Password_Salt, user.Password_Hash);
    if (!valid) {
      await recordFailure(loginRateLimitKey(emailOrUsername), LOGIN_RATE_LIMIT.MAX_ATTEMPTS, LOGIN_RATE_LIMIT.WINDOW_SECONDS, LOGIN_RATE_LIMIT.BLOCK_SECONDS);

      const percobaanBaru = (user.Percobaan_Password_Gagal || 0) + 1;
      const updatePayload: Record<string, unknown> = { Percobaan_Password_Gagal: percobaanBaru };
      if (percobaanBaru >= CONFIG.PASSWORD_GAGAL_BEKUKAN_AKUN) {
        updatePayload.Akun_Dibekukan = true;
      }
      await supabase.from("Users").update(updatePayload).eq("ID_User", user.ID_User);

      await logAudit("LOGIN_GAGAL", { email: emailOrUsername, reason: "Password salah", percobaanKe: percobaanBaru }, user.ID_User);

      if (percobaanBaru >= CONFIG.PASSWORD_GAGAL_BEKUKAN_AKUN) {
        throw new ApiError("AKUN_DIBEKUKAN::Akun Anda dibekukan karena 5x salah memasukkan password. Silakan hubungi Admin.");
      }
      if (percobaanBaru >= CONFIG.PASSWORD_GAGAL_TAMPIL_RESET) {
        throw new ApiError(`PASSWORD_SALAH_TAMPIL_RESET::Password salah. Percobaan ke-${percobaanBaru} dari ${CONFIG.PASSWORD_GAGAL_BEKUKAN_AKUN}. Anda bisa mereset password.`);
      }
      throw new ApiError(`PASSWORD_SALAH::Password salah. Percobaan ke-${percobaanBaru} dari ${CONFIG.PASSWORD_GAGAL_BEKUKAN_AKUN}.`);
    }

    if ((user.Percobaan_Password_Gagal || 0) > 0) {
      await supabase.from("Users").update({ Percobaan_Password_Gagal: 0 }).eq("ID_User", user.ID_User);
    }

    if (isLegacyPasswordHash(user.Password_Hash)) {
      try {
        const upgradedHash = await hashPassword(password, user.Password_Salt);
        await supabase.from("Users").update({ Password_Hash: upgradedHash }).eq("ID_User", user.ID_User);
        await logAudit("UPGRADE_HASH_PASSWORD", { email: emailOrUsername }, user.ID_User);
      } catch (eUpgrade) {
        console.error("Gagal upgrade hash password untuk " + emailOrUsername, eUpgrade);
      }
    }

    const sessionToken = generateToken();
    await saveSession(sessionToken, {
      type: "user",
      idUser: user.ID_User,
      username: user.Username,
      role: user.Role,
      nama: user.Nama_Lengkap,
    });

    await clearRateLimit(loginRateLimitKey(emailOrUsername));
    await logAudit("LOGIN_BERHASIL", { email: emailOrUsername, role: user.Role }, user.ID_User);

    return {
      success: true,
      token: sessionToken,
      ...sanitizeUser(user),
    };
  }

  // Login DEVICE (kios) tetap memakai Username_Device seperti sebelumnya
  const { data: device } = await supabase
    .from("Device_Absen")
    .select("*")
    .ilike("Username_Device", emailOrUsername)
    .maybeSingle();

  if (device) {
    if (!isActive(device.Status_Aktif)) {
      await logAudit("LOGIN_GAGAL", { username: emailOrUsername, reason: "Device tidak aktif" }, null);
      throw new ApiError("Username atau password salah");
    }

    const valid = await verifyPassword(password, device.Password_Salt, device.Password_Hash);
    if (!valid) {
      await recordFailure(loginRateLimitKey(emailOrUsername), LOGIN_RATE_LIMIT.MAX_ATTEMPTS, LOGIN_RATE_LIMIT.WINDOW_SECONDS, LOGIN_RATE_LIMIT.BLOCK_SECONDS);
      await logAudit("LOGIN_GAGAL", { username: emailOrUsername, reason: "Password device salah" }, device.Dibuat_Oleh);
      throw new ApiError("Username atau password salah");
    }

    if (isLegacyPasswordHash(device.Password_Hash)) {
      try {
        const upgradedHash = await hashPassword(password, device.Password_Salt);
        await supabase.from("Device_Absen").update({ Password_Hash: upgradedHash }).eq("ID_Device", device.ID_Device);
        await logAudit("UPGRADE_HASH_PASSWORD", { username: emailOrUsername, type: "device" }, device.Dibuat_Oleh);
      } catch (eUpgradeDevice) {
        console.error("Gagal upgrade hash password device untuk " + emailOrUsername, eUpgradeDevice);
      }
    }

    const sessionToken = generateToken();
    await saveSession(sessionToken, {
      type: "device",
      idDevice: device.ID_Device,
      username: device.Username_Device,
      lokasi: device.Lokasi_SPPG,
    });

    await clearRateLimit(loginRateLimitKey(emailOrUsername));
    await logAudit("LOGIN_BERHASIL", { username: emailOrUsername, type: "device", lokasi: device.Lokasi_SPPG }, device.Dibuat_Oleh);

    return {
      success: true,
      token: sessionToken,
      device: {
        idDevice: device.ID_Device,
        username: device.Username_Device,
        lokasi: device.Lokasi_SPPG,
      },
    };
  }

  await recordFailure(loginRateLimitKey(emailOrUsername), LOGIN_RATE_LIMIT.MAX_ATTEMPTS, LOGIN_RATE_LIMIT.WINDOW_SECONDS, LOGIN_RATE_LIMIT.BLOCK_SECONDS);
  await logAudit("LOGIN_GAGAL", { username: emailOrUsername, reason: "Username tidak ditemukan" }, null);
  throw new ApiError("Email/Username atau password salah");
}

async function logout(data: { token?: string }): Promise<unknown> {
  const token = data?.token || "";
  const session = await getSession(token);
  if (session) {
    if (session.type === "user") {
      await logAudit("LOGOUT", { username: session.username }, session.idUser || null);
    } else {
      await logAudit("LOGOUT", { username: session.username, type: "device" }, session.idDevice || null);
    }
  }
  await removeSession(token);
  return { success: true };
}

async function checkSession(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  return {
    valid: true,
    session: {
      type: session.type,
      idUser: session.idUser,
      idDevice: session.idDevice,
      role: session.role,
      username: session.username,
      nama: session.nama,
      lokasi: session.lokasi,
    },
  };
}
async function getPublicConfig(): Promise<unknown> {
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}
async function getMasterData(): Promise<unknown> {
  const { data: sppgRows, error: errSppg } = await supabase.from("Master_SPPG").select("*");
  if (errSppg) throw new Error("Data Master_SPPG tidak ditemukan atau error: " + errSppg.message);

  const { data: jabatanRows, error: errJabatan } = await supabase.from("Master_Jabatan").select("*");
  if (errJabatan) throw new Error("Data Master_Jabatan tidak ditemukan atau error: " + errJabatan.message);

  let sppgActive = (sppgRows || []).filter((s) => isActive(s.Aktif));
  if (sppgActive.length === 0 && (sppgRows || []).length > 0) sppgActive = sppgRows!;

  let jabatanActive = (jabatanRows || []).filter((j) => isActive(j.Aktif));
  if (jabatanActive.length === 0 && (jabatanRows || []).length > 0) jabatanActive = jabatanRows!;

  const sppgList = sppgActive.map((s) => s.Nama_SPPG).filter((v) => v !== "" && v != null);
  const jabatanList = jabatanActive.map((j) => j.Nama_Jabatan).filter((v) => v !== "" && v != null);

  return { sppg: sppgList, jabatan: jabatanList };
}

async function checkUsernameUnique(data: { username?: string }): Promise<unknown> {
  const usernameLower = String(data?.username || "").toLowerCase();

  const { data: userMatch } = await supabase.from("Users").select("ID_User").ilike("Username", usernameLower).maybeSingle();
  const { data: deviceMatch } = await supabase
    .from("Device_Absen")
    .select("ID_Device")
    .ilike("Username_Device", usernameLower)
    .maybeSingle();

  return { unique: !userMatch && !deviceMatch };
}

interface RegisterUserPayload {
  username?: string;
  password?: string;
  namaLengkap?: string;
  tempatLahir?: string;
  tanggalLahir?: string;
  jenisKelamin?: string;
  email?: string;
  noWhatsapp?: string;
  sppg?: string;
  sppgLainnya?: string;
  tanggalMulaiKerja?: string;
  jabatanDivisi?: string;
  jabatanLainnya?: string;
  gajiHarian?: number;
  namaBank?: string;
  atasNamaRekening?: string;
  fotoProfilBase64?: string;
  fotoProfilOriginalBase64?: string;
  fotoWajahBase64?: string;
  faceDescriptor?: unknown;
  setujuKebijakan?: boolean;
}

async function uploadBase64ToStorage(
  bucket: string,
  path: string,
  base64Data: string,
  contentType: string,
): Promise<string> {
  const base64 = base64Data.replace(/^data:[^;]+;base64,/, "");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Gagal upload file ke storage (${bucket}/${path}): ${error.message}`);
  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(path);
  return publicUrlData.publicUrl;
}

async function registerUser(data: RegisterUserPayload): Promise<unknown> {
  if (!data.username || !data.password || !data.namaLengkap) {
    throw new ApiError("Data tidak lengkap");
  }

  const username = String(data.username).toLowerCase();

  const uniqueCheck = (await checkUsernameUnique({ username })) as { unique: boolean };
  if (!uniqueCheck.unique) {
    throw new ApiError("Username sudah digunakan");
  }

  const idUser = crypto.randomUUID();

  let idCardUnik = generateIdCardUnik();
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: dupe } = await supabase.from("Users").select("ID_User").eq("ID_Card_Unik", idCardUnik).maybeSingle();
    if (!dupe) break;
    idCardUnik = generateIdCardUnik();
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(data.password, salt);

  let sppg = data.sppg || "";
  if (data.sppgLainnya && data.sppg === "LAINNYA") {
    sppg = data.sppgLainnya;
    await supabase.from("Master_SPPG").insert({ Nama_SPPG: sppg, Aktif: true });
  }

  let jabatanDivisi = data.jabatanDivisi || "";
  if (data.jabatanLainnya && data.jabatanDivisi === "LAINNYA") {
    jabatanDivisi = data.jabatanLainnya;
    await supabase.from("Master_Jabatan").insert({ Nama_Jabatan: jabatanDivisi, Aktif: true });
  }

  let fotoProfilUrl = "";
  let fotoProfilOriginalUrl = "";
  if (data.fotoProfilBase64) {
    fotoProfilUrl = await uploadBase64ToStorage("foto-profil", `${idUser}/foto.png`, data.fotoProfilBase64, "image/png");
  }
  if (data.fotoProfilOriginalBase64) {
    fotoProfilOriginalUrl = await uploadBase64ToStorage(
      "foto-profil",
      `${idUser}/foto_asli.jpg`,
      data.fotoProfilOriginalBase64,
      "image/jpeg",
    );
  }

  let fotoWajahUrl = "";
  if (data.fotoWajahBase64) {
    fotoWajahUrl = await uploadBase64ToStorage("data-wajah-ref", `${idUser}/wajah_ref.png`, data.fotoWajahBase64, "image/png");
  }

  // Buat user di Supabase Auth terlebih dahulu (email_confirm: false agar
  // Supabase mewajibkan verifikasi OTP). Wajib dilakukan SEBELUM signInWithOtp,
  // karena signInWithOtp(shouldCreateUser:false) tidak akan mengirim apa pun
  // jika user belum ada di Supabase Auth.
  const emailUntukAuth = (data.email || "").toLowerCase().trim();
  if (emailUntukAuth) {
    const { error: createAuthError } = await supabase.auth.admin.createUser({
      email: emailUntukAuth,
      password: data.password,
      email_confirm: false,
      user_metadata: { id_user: idUser, nama: data.namaLengkap },
    });
    if (createAuthError) {
      console.error("Gagal membuat user Supabase Auth:", createAuthError.message);
    }
  }

  const userData = {
    ID_User: idUser,
    Username: username,
    Password_Hash: passwordHash,
    Password_Salt: salt,
    Role: "USER",
    Status_Aktif: true,
    Nama_Lengkap: data.namaLengkap,
    Tempat_Lahir: data.tempatLahir || "",
    Tanggal_Lahir: data.tanggalLahir || null,
    Jenis_Kelamin: data.jenisKelamin || "",
    Email: data.email || "",
    No_Whatsapp: data.noWhatsapp || "",
    SPPG: sppg,
    Tanggal_Mulai_Kerja: data.tanggalMulaiKerja || null,
    Jabatan_Divisi: jabatanDivisi,
    Gaji_Harian: data.gajiHarian || 0,
    Nama_Bank: data.namaBank || "",
    Atas_Nama_Rekening: data.atasNamaRekening || "",
    ID_Card_Unik: idCardUnik,
    URL_Foto_Profil: fotoProfilUrl,
    URL_Foto_Profil_Asli: fotoProfilOriginalUrl,
    URL_Foto_Wajah_Ref: fotoWajahUrl,
    Face_Descriptor_JSON: data.faceDescriptor ? data.faceDescriptor : null,
    URL_ID_Card_PDF: "",
    Setuju_Kebijakan_Data: data.setujuKebijakan ? true : false,
    Token_Reset_Password: "",
  };

  const { error: insertError } = await supabase.from("Users").insert(userData);
  if (insertError) throw new Error("Gagal menyimpan user: " + insertError.message);

  // Set akun belum aktif sampai kode OTP diverifikasi
  await supabase.from("Users").update({ Status_Aktif: false }).eq("ID_User", idUser);

  // Kirim kode OTP 6 digit ke email
  const emailForVerify = data.email || "";
  if (emailForVerify) {
    try {
      await generateAndSendOtp(emailForVerify, idUser, data.namaLengkap || "");
    } catch (eOtp) {
      console.error("Gagal mengirim kode OTP:", eOtp);
      throw new ApiError("Registrasi tersimpan namun gagal mengirim email kode verifikasi. Silakan gunakan 'Kirim Ulang Kode'.");
    }
  }

  await logAudit("REGISTER_BERHASIL", { idUser, username }, idUser);

  return {
    success: true,
    idUser,
    idCardUnik,
    email: emailForVerify,
    message: "Registrasi berhasil! Silakan cek email Anda untuk kode verifikasi.",
  };
}

async function verifyRegistrationOtp(data: { email?: string; kodeOtp?: string }): Promise<unknown> {
  const email = String(data?.email || "").trim().toLowerCase();
  const kodeOtp = String(data?.kodeOtp || "").trim();
  if (!email || !kodeOtp) throw new ApiError("Email dan kode OTP wajib diisi");

  const { data: otpRow } = await supabase.from("Email_OTP").select("*").eq("Email", email).maybeSingle();
  if (!otpRow) throw new ApiError("Kode OTP tidak ditemukan. Silakan minta kode baru.");

  if (new Date(otpRow.Expires_At).getTime() < Date.now()) {
    throw new ApiError("Kode OTP sudah kedaluwarsa. Silakan minta kode baru.");
  }

  if (otpRow.Percobaan_Gagal >= CONFIG.OTP_MAX_PERCOBAAN) {
    throw new ApiError("Terlalu banyak percobaan salah. Silakan minta kode baru.");
  }

  if (otpRow.Kode_OTP !== kodeOtp) {
    await supabase.from("Email_OTP").update({ Percobaan_Gagal: (otpRow.Percobaan_Gagal || 0) + 1 }).eq("Email", email);
    throw new ApiError("Kode OTP salah. Silakan coba lagi.");
  }

  const { error: updateError } = await supabase.from("Users").update({ Status_Aktif: true }).eq("ID_User", otpRow.ID_User);
  if (updateError) throw new Error("Gagal mengaktifkan akun: " + updateError.message);

  await supabase.from("Email_OTP").delete().eq("Email", email);
  await logAudit("VERIFIKASI_OTP_BERHASIL", { email }, otpRow.ID_User);

  return { success: true, message: "Email berhasil diverifikasi! Silakan login." };
}

async function resendConfirmationEmail(data: { email?: string }): Promise<unknown> {
  const email = String(data?.email || "").trim().toLowerCase();
  if (!email) throw new ApiError("Email wajib diisi");

  const { data: user } = await supabase.from("Users").select("ID_User, Email, Nama_Lengkap, Status_Aktif").eq("Email", email).maybeSingle();
  if (!user) {
    throw new ApiError("Email tidak terdaftar.");
  }

  if (isActive(user.Status_Aktif)) {
    return { success: true, message: "Email Anda sudah terverifikasi. Silakan login." };
  }

  const { data: otpRow } = await supabase.from("Email_OTP").select("*").eq("Email", email).maybeSingle();

  const now = Date.now();
  const resendCount = otpRow?.Resend_Count || 0;
  const nextResendAt = otpRow?.Next_Resend_At ? new Date(otpRow.Next_Resend_At).getTime() : 0;

  if (resendCount >= CONFIG.RESEND_OTP_MAX_PER_DAY) {
    throw new ApiError("Anda sudah mencapai batas maksimal 3x kirim ulang kode hari ini. Silakan hubungi Admin.");
  }

  if (nextResendAt && now < nextResendAt) {
    const sisaDetik = Math.ceil((nextResendAt - now) / 1000);
    throw new ApiError(`TUNGGU::Mohon tunggu ${sisaDetik} detik sebelum meminta kode baru.`);
  }

  try {
    await generateAndSendOtp(email, user.ID_User, user.Nama_Lengkap || "", "REGISTRASI", true);
  } catch (eOtp) {
    console.error("Gagal mengirim ulang kode OTP:", eOtp);
    throw new ApiError("Gagal mengirim ulang kode verifikasi. Coba lagi nanti.");
  }

  const cooldownBaruDetik = CONFIG.RESEND_OTP_BASE_COOLDOWN_SECONDS * Math.pow(2, resendCount);
  const resendCountBaru = resendCount + 1;
  const nextResendAtBaru = new Date(now + cooldownBaruDetik * 1000).toISOString();

  await supabase.from("Email_OTP").update({
    Resend_Count: resendCountBaru,
    Next_Resend_At: nextResendAtBaru,
  }).eq("Email", email);

  await logAudit("RESEND_KODE_OTP", { email, resendCountBaru, cooldownBaruDetik }, user.ID_User);

  return {
    success: true,
    message: "Kode verifikasi berhasil dikirim ulang. Silakan cek inbox/spam.",
    cooldownDetik: cooldownBaruDetik,
    sisaKirimUlang: CONFIG.RESEND_OTP_MAX_PER_DAY - resendCountBaru,
  };
}

async function requestResetPasswordByEmail(data: { email?: string }): Promise<unknown> {
  const email = String(data?.email || "").trim().toLowerCase();
  if (!email) throw new ApiError("Email wajib diisi");

  const { data: user } = await supabase.from("Users").select("ID_User, Email, Nama_Lengkap, Akun_Dibekukan").eq("Email", email).maybeSingle();
  if (!user) {
    throw new ApiError("Email tidak terdaftar.");
  }

  try {
    await generateAndSendOtp(email, user.ID_User, user.Nama_Lengkap || "", "RESET");
  } catch (eOtp) {
    console.error("Gagal mengirim kode reset password:", eOtp);
    throw new ApiError("Gagal mengirim kode reset password. Coba lagi nanti.");
  }

  await logAudit("REQUEST_RESET_PASSWORD", { email }, user.ID_User);

  return { success: true, message: "Kode reset password berhasil dikirim ke email Anda." };
}

async function verifyResetPasswordOtp(data: { email?: string; kodeOtp?: string }): Promise<unknown> {
  const email = String(data?.email || "").trim().toLowerCase();
  const kodeOtp = String(data?.kodeOtp || "").trim();
  if (!email || !kodeOtp) throw new ApiError("Email dan kode OTP wajib diisi");

  const { data: otpRow } = await supabase.from("Email_OTP").select("*").eq("Email", email).eq("Tujuan", "RESET").maybeSingle();
  if (!otpRow) throw new ApiError("Kode OTP tidak ditemukan. Silakan minta kode baru.");

  if (new Date(otpRow.Expires_At).getTime() < Date.now()) {
    throw new ApiError("Kode OTP sudah kedaluwarsa. Silakan minta kode baru.");
  }

  if (otpRow.Percobaan_Gagal >= CONFIG.OTP_MAX_PERCOBAAN) {
    throw new ApiError("Terlalu banyak percobaan salah. Silakan minta kode baru.");
  }

  if (otpRow.Kode_OTP !== kodeOtp) {
    await supabase.from("Email_OTP").update({ Percobaan_Gagal: (otpRow.Percobaan_Gagal || 0) + 1 }).eq("Email", email);
    throw new ApiError("Kode OTP salah. Silakan coba lagi.");
  }

  const randomStr = String(Math.floor(10000000 + Math.random() * 90000000));
  const expiry = Date.now() + CONFIG.RESET_TOKEN_DURATION_MS;
  const resetToken = randomStr + "_" + expiry;

  const { error: updateError } = await supabase.from("Users").update({ Token_Reset_Password: resetToken }).eq("ID_User", otpRow.ID_User);
  if (updateError) throw new Error("Gagal menyimpan token reset: " + updateError.message);

  await supabase.from("Email_OTP").delete().eq("Email", email).eq("Tujuan", "RESET");
  await logAudit("VERIFIKASI_OTP_RESET_BERHASIL", { email }, otpRow.ID_User);

  return { success: true, resetToken, message: "Kode terverifikasi. Silakan buat password baru." };
}

async function requestResetPassword(data: { username?: string; email?: string; idCardUnik?: string }): Promise<unknown> {
  const { username, email, idCardUnik } = data || {};
  if (!username) throw new ApiError("Username wajib diisi");

  await checkRateLimit(
    resetRateLimitKey(username),
    RESET_RATE_LIMIT.MAX_ATTEMPTS,
    "Terlalu banyak percobaan reset password gagal. Coba lagi dalam 15 menit atau hubungi Admin.",
  );

  const { data: user } = await supabase
    .from("Users")
    .select("*")
    .eq("Username", username)
    .eq("Email", email)
    .eq("ID_Card_Unik", idCardUnik)
    .maybeSingle();

  if (!user) {
    await recordFailure(resetRateLimitKey(username), RESET_RATE_LIMIT.MAX_ATTEMPTS, RESET_RATE_LIMIT.WINDOW_SECONDS, RESET_RATE_LIMIT.BLOCK_SECONDS);
    throw new ApiError("Data tidak cocok. Pastikan Username, Email, dan ID Card benar.");
  }

  const randomStr = String(Math.floor(10000000 + Math.random() * 90000000));
  const expiry = Date.now() + CONFIG.RESET_TOKEN_DURATION_MS;
  const token = randomStr + "_" + expiry;

  const { error: updateError } = await supabase.from("Users").update({ Token_Reset_Password: token }).eq("ID_User", user.ID_User);
  if (updateError) throw new Error("Gagal menyimpan token reset: " + updateError.message);

  const menitBerlaku = Math.round(CONFIG.RESET_TOKEN_DURATION_MS / 60000);

  return { success: true, resetCode: randomStr, message: "Kode reset password berhasil dibuat." };
}

async function resetPassword(data: { username?: string; email?: string; token?: string; newPassword?: string }): Promise<unknown> {
  const { username, email, token, newPassword } = data || {};
  const identifier = username || email;
  if (!identifier || !token || !newPassword) throw new ApiError("Data tidak lengkap");

  await checkRateLimit(
    resetRateLimitKey(identifier),
    RESET_RATE_LIMIT.MAX_ATTEMPTS,
    "Terlalu banyak percobaan reset password gagal. Coba lagi dalam 15 menit atau hubungi Admin.",
  );

  const query = username
    ? supabase.from("Users").select("*").eq("Username", username)
    : supabase.from("Users").select("*").eq("Email", String(email).toLowerCase());
  const { data: user } = await query.maybeSingle();

  if (!user) {
    await recordFailure(resetRateLimitKey(identifier), RESET_RATE_LIMIT.MAX_ATTEMPTS, RESET_RATE_LIMIT.WINDOW_SECONDS, RESET_RATE_LIMIT.BLOCK_SECONDS);
    throw new ApiError("User tidak ditemukan");
  }
  if (!user.Token_Reset_Password) {
    await recordFailure(resetRateLimitKey(identifier), RESET_RATE_LIMIT.MAX_ATTEMPTS, RESET_RATE_LIMIT.WINDOW_SECONDS, RESET_RATE_LIMIT.BLOCK_SECONDS);
    throw new ApiError("Token tidak valid");
  }

  const storedParts = String(user.Token_Reset_Password).split("_");
  const storedCode = storedParts[0];
  if (storedCode !== String(token).trim()) {
    await recordFailure(resetRateLimitKey(identifier), RESET_RATE_LIMIT.MAX_ATTEMPTS, RESET_RATE_LIMIT.WINDOW_SECONDS, RESET_RATE_LIMIT.BLOCK_SECONDS);
    throw new ApiError("Token tidak valid");
  }

  const parts = String(user.Token_Reset_Password).split("_");
  if (parts.length < 2) throw new ApiError("Token tidak valid");
  const expiry = parseInt(parts[parts.length - 1], 10);
  if (isNaN(expiry) || Date.now() > expiry) {
    await supabase.from("Users").update({ Token_Reset_Password: "" }).eq("ID_User", user.ID_User);
    throw new ApiError("Token sudah expired. Silakan ulangi proses lupa password.");
  }

  await clearRateLimit(resetRateLimitKey(identifier));

  const salt = generateSalt();
  const passwordHash = await hashPassword(newPassword, salt);

  const { error: updateError } = await supabase
    .from("Users")
    .update({
      Password_Hash: passwordHash,
      Password_Salt: salt,
      Token_Reset_Password: "",
      Percobaan_Password_Gagal: 0,
      Akun_Dibekukan: false,
    })
    .eq("ID_User", user.ID_User);
  if (updateError) throw new Error("Gagal menyimpan password baru: " + updateError.message);

  await logAudit("RESET_PASSWORD", { identifier }, user.ID_User);

  return { success: true, message: "Password berhasil diubah" };
}

async function changePassword(data: {
  token?: string;
  passwordLama?: string;
  passwordBaru?: string;
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak");

  const { passwordLama, passwordBaru } = data;
  if (!passwordLama || !passwordBaru) throw new ApiError("Password lama dan password baru wajib diisi");
  if (passwordBaru.length < 6) throw new ApiError("Password baru minimal 6 karakter");

  const { data: user } = await supabase
    .from("Users")
    .select("*")
    .eq("ID_User", session.idUser)
    .maybeSingle();
  if (!user) throw new ApiError("User tidak ditemukan");

  const valid = await verifyPassword(passwordLama, user.Password_Salt, user.Password_Hash);
  if (!valid) throw new ApiError("Password lama tidak sesuai");

  const salt = generateSalt();
  const passwordHash = await hashPassword(passwordBaru, salt);

  const { error } = await supabase
    .from("Users")
    .update({
      Password_Hash: passwordHash,
      Password_Salt: salt,
      Updated_At: new Date().toISOString(),
    })
    .eq("ID_User", session.idUser);
  if (error) throw new Error("Gagal menyimpan password baru: " + error.message);

  await logAudit("CHANGE_PASSWORD", { idUser: session.idUser }, session.idUser || null);
  return { success: true, message: "Password berhasil diubah" };
}

async function toggleDeviceStatus(data: {
  token?: string;
  idDevice?: string;
  status?: boolean;
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak");

  const { idDevice, status } = data;
  if (!idDevice) throw new ApiError("ID Device wajib diisi");

  const { error } = await supabase
    .from("Device_Absen")
    .update({ Status_Aktif: status })
    .eq("ID_Device", idDevice);
  if (error) throw new Error("Gagal mengubah status device: " + error.message);

  await logAudit("TOGGLE_STATUS_DEVICE", { idDevice, newStatus: status }, session.idUser || null);
  return { success: true, message: "Status device diperbarui" };
}

async function resetDevicePassword(data: {
  token?: string;
  idDevice?: string;
  passwordBaru?: string;
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak");

  const { idDevice, passwordBaru } = data;
  if (!idDevice || !passwordBaru) throw new ApiError("ID Device dan password baru wajib diisi");

  const salt = generateSalt();
  const passwordHash = await hashPassword(passwordBaru, salt);

  const { error } = await supabase
    .from("Device_Absen")
    .update({ Password_Hash: passwordHash, Password_Salt: salt })
    .eq("ID_Device", idDevice);
  if (error) throw new Error("Gagal mereset password device: " + error.message);

  await logAudit("RESET_PASSWORD_DEVICE", { idDevice }, session.idUser || null);
  return { success: true, message: "Password device berhasil direset" };
}

function parseFaceDescriptor(raw: unknown): number[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === "object") return raw as number[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function hitungSkorKecocokanWajah(descriptorReferensi: number[] | null, descriptorScan: number[]): number {
  if (!Array.isArray(descriptorReferensi) || !Array.isArray(descriptorScan)) return 0;
  if (descriptorReferensi.length !== descriptorScan.length || descriptorReferensi.length === 0) return 0;

  let sumSquare = 0;
  for (let i = 0; i < descriptorReferensi.length; i++) {
    const a = Number(descriptorReferensi[i]);
    const b = Number(descriptorScan[i]);
    if (isNaN(a) || isNaN(b)) return 0;
    sumSquare += (a - b) * (a - b);
  }
  const jarak = Math.sqrt(sumSquare);
  return (1 - jarak) * 100;
}

async function getScopedUsers(session: SessionData): Promise<Record<string, any>[]> {
  const { data: allUsers } = await supabase.from("Users").select("*");
  if (!allUsers) return [];

  if (isSuperAdmin(session.role)) return allUsers;

  if (session.role === "ADMIN" || session.role === "AKUNTAN") {
    const diriSendiri = allUsers.find((u) => u.ID_User === session.idUser);
    const email = diriSendiri ? diriSendiri.Email : null;
    const sppgList = email ? await getAksesEmailSppgList(email) : [];

    if (sppgList.length > 0) {
      const normalizedSppg = new Set(sppgList.map((s) => String(s).trim().toUpperCase()));
      return allUsers.filter((u) =>
        normalizedSppg.has(String(u.SPPG || "").trim().toUpperCase()) && !isSuperAdmin(u.Role)
      );
    }

    // Belum ada mapping akses: hanya bisa melihat data diri sendiri
    return diriSendiri ? [diriSendiri] : [];
  }

  return [];
}

async function getScopedUserIdSet(session: SessionData): Promise<Set<string>> {
  const users = await getScopedUsers(session);
  return new Set(users.map((u) => u.ID_User));
}

async function acquireAbsenLock(idUser: string): Promise<boolean> {
  const now = Date.now();
  const { data: existing } = await supabase.from("Absen_Locks").select("*").eq("ID_User", idUser).maybeSingle();

  if (existing && new Date(existing.Expires_At).getTime() > now) {
    return false;
  }

  const expiresAt = new Date(now + 15000).toISOString();
  const { error } = await supabase
    .from("Absen_Locks")
    .upsert({ ID_User: idUser, Locked_At: new Date().toISOString(), Expires_At: expiresAt });

  return !error;
}

async function releaseAbsenLock(idUser: string): Promise<void> {
  await supabase.from("Absen_Locks").delete().eq("ID_User", idUser);
}

async function registerDevice(data: {
  token?: string;
  deviceData?: { username?: string; password?: string; namaDevice?: string; lokasiSppg?: string };
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak");

  const deviceData = data.deviceData || {};
  if (!deviceData.username || !deviceData.password) throw new ApiError("Data tidak lengkap");

  const { data: userMatch } = await supabase.from("Users").select("ID_User").eq("Username", deviceData.username).maybeSingle();
  const { data: deviceMatch } = await supabase
    .from("Device_Absen")
    .select("ID_Device")
    .eq("Username_Device", deviceData.username)
    .maybeSingle();
  if (userMatch || deviceMatch) throw new ApiError("Username sudah digunakan");

  const idDevice = generateId("DEV");
  const salt = generateSalt();
  const passwordHash = await hashPassword(deviceData.password, salt);

  const { error: insertError } = await supabase.from("Device_Absen").insert({
    ID_Device: idDevice,
    Username_Device: deviceData.username,
    Password_Hash: passwordHash,
    Password_Salt: salt,
    Nama_Device: deviceData.namaDevice || "",
    Lokasi_SPPG: deviceData.lokasiSppg || "",
    Status_Aktif: true,
    Dibuat_Oleh: session.idUser,
  });
  if (insertError) throw new Error("Gagal menyimpan device: " + insertError.message);

  await logAudit("REGISTER_DEVICE", { idDevice, username: deviceData.username }, session.idUser || null);

  return { success: true, idDevice, password: deviceData.password };
}

async function getAllDevices(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak");

  const { data: devices, error } = await supabase.from("Device_Absen").select("*");
  if (error) throw new Error("Gagal mengambil data device: " + error.message);

  return { success: true, devices: devices || [] };
}

async function getMyFaceProfile(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak. Hanya untuk user yang sudah login.");

  const { data: user } = await supabase.from("Users").select("*").eq("ID_User", session.idUser).maybeSingle();
  if (!user) throw new ApiError("User tidak ditemukan");
  if (!isActive(user.Status_Aktif)) throw new ApiError("Akun tidak aktif");

  return {
    found: true,
    user: {
      idUser: user.ID_User,
      namaLengkap: user.Nama_Lengkap,
      sppg: user.SPPG,
      faceDescriptor: parseFaceDescriptor(user.Face_Descriptor_JSON),
    },
  };
}

async function lookupUserByIdCardSelf(data: { token?: string; idCardUnik?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak. Hanya untuk user yang sudah login.");

  const cleanId = (data?.idCardUnik || "").toString().trim().toUpperCase();
  const { data: user } = await supabase
    .from("Users")
    .select("*")
    .ilike("ID_Card_Unik", cleanId)
    .maybeSingle();

  if (!user || !isActive(user.Status_Aktif)) return { found: false };

  return {
    found: true,
    user: {
      idUser: user.ID_User,
      namaLengkap: user.Nama_Lengkap,
      sppg: user.SPPG,
    },
  };
}

async function verifyFaceLiveByIdUser(data: {
  token?: string;
  idUser?: string;
  faceDescriptorScan?: number[];
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" && session.type !== "device") throw new ApiError("Akses ditolak.");

  const { idUser, faceDescriptorScan } = data || {};
  if (!idUser) throw new ApiError("ID User tidak ditemukan");
  if (!Array.isArray(faceDescriptorScan) || faceDescriptorScan.length === 0) throw new ApiError("Data wajah tidak valid");

  const { data: user } = await supabase.from("Users").select("*").eq("ID_User", idUser).maybeSingle();
  if (!user || !isActive(user.Status_Aktif)) return { skor: 0 };

  const descriptorReferensi = parseFaceDescriptor(user.Face_Descriptor_JSON);
  if (!descriptorReferensi) return { skor: 0 };

  return { skor: hitungSkorKecocokanWajah(descriptorReferensi, faceDescriptorScan) };
}

async function recordAbsensiSelf(data: {
  token?: string;
  idUser?: string;
  faceDescriptorScan?: number[];
  lat?: number;
  lng?: number;
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak. Hanya untuk user yang sudah login.");

  const { idUser: targetIdUser, faceDescriptorScan, lat, lng } = data || {};
  if (!targetIdUser) throw new ApiError("ID User tidak ditemukan");

  const { data: user } = await supabase.from("Users").select("*").eq("ID_User", targetIdUser).maybeSingle();
  if (!user) throw new ApiError("User tidak ditemukan");

  if (!Array.isArray(faceDescriptorScan) || faceDescriptorScan.length === 0) {
    throw new ApiError("Data wajah tidak valid. Silakan scan ulang.");
  }
  const descriptorReferensi = parseFaceDescriptor(user.Face_Descriptor_JSON);
  if (!descriptorReferensi) {
    return { success: false, message: "Data wajah referensi belum terdaftar. Silakan daftarkan wajah di menu Profil." };
  }
  const skorNumServer = hitungSkorKecocokanWajah(descriptorReferensi, faceDescriptorScan);

  const cekLokasi = validasiLokasiSppg(user.SPPG, lat, lng);
  if (!cekLokasi.valid) {
    const pesanLokasi =
      cekLokasi.alasan === "LOKASI_TIDAK_TERSEDIA"
        ? "Lokasi GPS tidak terdeteksi. Aktifkan layanan lokasi dan coba lagi."
        : `Anda berada di luar radius lokasi SPPG ${user.SPPG} (jarak: ${cekLokasi.jarak} meter, maksimal ${RADIUS_ABSEN_METER} meter).`;
    await logAudit("ABSEN_MANDIRI_DITOLAK_LOKASI", { idUser: targetIdUser, sppg: user.SPPG, jarak: cekLokasi.jarak, lat, lng }, targetIdUser);
    return { success: false, message: pesanLokasi };
  }

  const skorValid = skorNumServer >= CONFIG.FACE_THRESHOLD * 100;
  const statusValidasiServer = skorValid ? "VALID" : "INVALID";

  const lockAcquired = await acquireAbsenLock(targetIdUser);
  if (!lockAcquired) {
    return { success: false, message: "Absen Anda sedang diproses, mohon tunggu sebentar." };
  }

  try {
    const today = new Date();
    const todayStr = toDateStr(today);

    const { data: todayAbsensi } = await supabase
      .from("Absensi")
      .select("*")
      .eq("ID_User", targetIdUser)
      .eq("Tanggal", todayStr);

    const hasDatang = (todayAbsensi || []).some((a) => a.Jenis_Absen === "DATANG" && a.Status_Validasi === "VALID");
    const hasPulang = (todayAbsensi || []).some((a) => a.Jenis_Absen === "PULANG" && a.Status_Validasi === "VALID");

    let jenisAbsen = "";
    if (!hasDatang) jenisAbsen = "DATANG";
    else if (!hasPulang) jenisAbsen = "PULANG";
    else return { success: false, message: "Anda sudah absen Datang & Pulang hari ini" };

    if (!skorValid) {
      await logAudit("ABSEN_MANDIRI_DITOLAK_SKOR", { idUser: targetIdUser, jenisAbsen, skor: skorNumServer }, targetIdUser);
      return { success: false, message: "Wajah tidak dikenali dengan cukup akurat. Silakan coba lagi." };
    }

    const idAbsen = generateId("ABS");
    const { error: insertError } = await supabase.from("Absensi").insert({
      ID_Absen: idAbsen,
      ID_User: targetIdUser,
      Tanggal: todayStr,
      Jenis_Absen: jenisAbsen,
      Waktu_Timestamp: new Date().toISOString(),
      ID_Device: "SELF_" + session.idUser,
      Skor_Kecocokan_Wajah: skorNumServer,
      Status_Validasi: statusValidasiServer,
      SPPG: user.SPPG,
      ID_Payroll: "",
    });
    if (insertError) throw new Error("Gagal menyimpan absensi: " + insertError.message);

    await logAudit("ABSEN_MANDIRI_BERHASIL", { idUser: targetIdUser, jenisAbsen, skor: skorNumServer }, targetIdUser);

    return {
      success: true,
      message: jenisAbsen,
      nama: user.Nama_Lengkap,
      waktu: new Date().toTimeString().split(" ")[0],
    };
  } catch (e) {
    await logAudit("ABSEN_MANDIRI_ERROR", { idUser: targetIdUser, error: e instanceof Error ? e.message : String(e) }, targetIdUser);
    throw e;
  } finally {
    await releaseAbsenLock(targetIdUser);
  }
}

async function lookupUserByIdCard(data: { token?: string; idCardUnik?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "device") throw new ApiError("Akses ditolak. Hanya perangkat absen.");

  const cleanId = (data?.idCardUnik || "").toString().trim().toUpperCase();
  const { data: user } = await supabase.from("Users").select("*").ilike("ID_Card_Unik", cleanId).maybeSingle();
  if (!user) return { found: false };

  return {
    found: true,
    user: { idUser: user.ID_User, namaLengkap: user.Nama_Lengkap, sppg: user.SPPG },
  };
}

async function recordAbsensi(data: { token?: string; idUser?: string; faceDescriptorScan?: number[] }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "device") throw new ApiError("Akses ditolak. Hanya perangkat absen.");

  const { idUser, faceDescriptorScan } = data || {};
  const { data: user } = await supabase.from("Users").select("*").eq("ID_User", idUser).maybeSingle();
  if (!user) throw new ApiError("User tidak ditemukan");

  if (!Array.isArray(faceDescriptorScan) || faceDescriptorScan.length === 0) {
    throw new ApiError("Data wajah tidak valid. Silakan scan ulang.");
  }
  const descriptorReferensi = parseFaceDescriptor(user.Face_Descriptor_JSON);
  if (!descriptorReferensi) {
    return { success: false, message: "Data wajah referensi belum terdaftar untuk user ini." };
  }
  const skorNumServer = hitungSkorKecocokanWajah(descriptorReferensi, faceDescriptorScan);
  const skorValid = skorNumServer >= CONFIG.FACE_THRESHOLD * 100;
  const statusValidasiServer = skorValid ? "VALID" : "INVALID";

  const lockAcquired = await acquireAbsenLock(idUser!);
  if (!lockAcquired) {
    return { success: false, message: "Absen untuk user ini sedang diproses, mohon tunggu sebentar." };
  }

  try {
    const today = new Date();
    const todayStr = toDateStr(today);

    const { data: todayAbsensi } = await supabase.from("Absensi").select("*").eq("ID_User", idUser).eq("Tanggal", todayStr);

    const hasDatang = (todayAbsensi || []).some((a) => a.Jenis_Absen === "DATANG" && a.Status_Validasi === "VALID");
    const hasPulang = (todayAbsensi || []).some((a) => a.Jenis_Absen === "PULANG" && a.Status_Validasi === "VALID");

    let jenisAbsen = "";
    if (!hasDatang) jenisAbsen = "DATANG";
    else if (!hasPulang) jenisAbsen = "PULANG";
    else return { success: false, message: "Anda sudah absen Datang & Pulang hari ini" };

    if (!skorValid) {
      await logAudit("ABSEN_DITOLAK_SKOR", { idUser, jenisAbsen, idDevice: session.idDevice, skor: skorNumServer }, idUser || null);
      return { success: false, message: "Wajah tidak dikenali dengan cukup akurat. Silakan coba lagi." };
    }

    const idAbsen = generateId("ABS");
    const { error: insertError } = await supabase.from("Absensi").insert({
      ID_Absen: idAbsen,
      ID_User: idUser,
      Tanggal: todayStr,
      Jenis_Absen: jenisAbsen,
      Waktu_Timestamp: new Date().toISOString(),
      ID_Device: session.idDevice,
      Skor_Kecocokan_Wajah: skorNumServer,
      Status_Validasi: statusValidasiServer,
      SPPG: user.SPPG,
      ID_Payroll: "",
    });
    if (insertError) throw new Error("Gagal menyimpan absensi: " + insertError.message);

    await logAudit("ABSEN_BERHASIL", { idUser, jenisAbsen, idDevice: session.idDevice, skor: skorNumServer }, idUser || null);

    return {
      success: true,
      message: jenisAbsen,
      nama: user.Nama_Lengkap,
      waktu: new Date().toTimeString().split(" ")[0],
    };
  } catch (e) {
    await logAudit("ABSEN_ERROR", { idUser, error: e instanceof Error ? e.message : String(e), idDevice: session.idDevice }, idUser || null);
    throw e;
  } finally {
    await releaseAbsenLock(idUser!);
  }
}

async function getAbsensiData(data: {
  token?: string;
  filters?: { tanggal?: string; sppg?: string; jabatan?: string };
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !canManageOperations(session.role)) throw new ApiError("Akses ditolak");

  const scopedIds = await getScopedUserIdSet(session);
  const users = await getScopedUsers(session);
  const userMap: Record<string, any> = {};
  users.forEach((u) => (userMap[u.ID_User] = u));

  const allAbsensi = await selectAllRows("Absensi");
  let filtered = allAbsensi.filter((a) => scopedIds.has(a.ID_User));

  const filters = data.filters;
  if (filters) {
    if (filters.tanggal) {
      const fStr = toDateStr(filters.tanggal);
      filtered = filtered.filter((a) => toDateStr(a.Tanggal) === fStr);
    }
    if (filters.sppg) {
      filtered = filtered.filter((a) => userMap[a.ID_User]?.SPPG === filters.sppg);
    }
    if (filters.jabatan) {
      filtered = filtered.filter((a) => userMap[a.ID_User]?.Jabatan_Divisi === filters.jabatan);
    }
  }

  const result = filtered.map((a) => {
    const user = userMap[a.ID_User];
    return {
      ...a,
      namaLengkap: user ? user.Nama_Lengkap : "Unknown",
      role: user ? user.Role : "",
      jabatanDivisi: user ? user.Jabatan_Divisi : "",
      sppg: user ? user.SPPG : "",
    };
  });

  return { success: true, absensi: result };
}

async function getAbsensiGroupedData(data: {
  token?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !canManageOperations(session.role)) throw new ApiError("Akses ditolak");

  const scopedIds = [...(await getScopedUserIdSet(session))];
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(data.pageSize) || 20));
  if (scopedIds.length === 0) return { absensi: [], total: 0, page, pageSize };

  const { data: result, error } = await supabase.rpc("get_absensi_grouped_page", {
    p_user_ids: scopedIds,
    p_page: page,
    p_page_size: pageSize,
    p_search: String(data.search || "").trim() || null,
  });
  if (error) throw new Error("Gagal mengambil data absensi: " + error.message);

  const rows = (result || []).map((item: any) => item.row_data);
  return {
    absensi: rows,
    total: Number(result?.[0]?.total_count || 0),
    page,
    pageSize,
  };
}

async function getMyAbsensi(data: { token?: string; filterBulan?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak");

  const allAbsensi = await selectAllRows("Absensi", "*", (q) => q.eq("ID_User", session.idUser));
  let filtered = allAbsensi;

  if (data.filterBulan) {
    filtered = filtered.filter((a) => toDateStr(a.Tanggal).substring(0, 7) === data.filterBulan);
  }

  const byDate: Record<string, { punches: Record<string, any>[] }> = {};
  filtered.filter((a) => a.Status_Validasi === "VALID").forEach((a) => {
    const tStr = toDateStr(a.Tanggal);
    if (!byDate[tStr]) byDate[tStr] = { punches: [] };
    byDate[tStr].punches.push({
      waktu: toJakartaTime(a.Waktu_Timestamp),
      timestamp: a.Waktu_Timestamp,
      jenis: a.Jenis_Absen,
      sumber: a.Sumber_Data || "APLIKASI",
      urutan: a.Urutan_Punch || null,
    });
  });

  const rows = Object.keys(byDate)
    .sort((a, b) => b.localeCompare(a))
    .map((tStr) => {
      const punches = byDate[tStr].punches.sort((a, b) =>
        String(a.timestamp || "").localeCompare(String(b.timestamp || ""))
      );
      const datangPunch = punches.find((p) => p.jenis === "DATANG");
      const pulangPunch = [...punches].reverse().find((p) => p.jenis === "PULANG");
      const isSingle = punches.length === 1 || punches.some((p) => p.jenis === "PUNCH_TUNGGAL");
      const lengkap = !!(datangPunch && pulangPunch);
      return {
        tanggal: tStr,
        datang: datangPunch?.waktu || (isSingle ? punches[0]?.waktu : null),
        pulang: pulangPunch?.waktu || null,
        punches,
        lengkap,
        status: lengkap ? "LENGKAP" : isSingle ? "PUNCH_TUNGGAL_VALID" : "BELUM_LENGKAP",
      };
    });

  return {
    rows,
    totalHariKerja: rows.filter((r) => r.lengkap).length,
    totalDatang: rows.filter((r) => r.datang).length,
    totalPulang: rows.filter((r) => r.pulang).length,
  };
}

async function getDataKaryawan(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !canManageOperations(session.role)) throw new ApiError("Akses ditolak");

  const users = await getScopedUsers(session);
  return {
    success: true,
    karyawan: users.map((u) => ({
      idUser: u.ID_User,
      namaLengkap: u.Nama_Lengkap,
      role: u.Role,
      jabatanDivisi: u.Jabatan_Divisi,
      jenisKelamin: u.Jenis_Kelamin,
      email: u.Email,
      noWhatsapp: u.No_Whatsapp,
      tanggalMulaiKerja: u.Tanggal_Mulai_Kerja,
      sppg: u.SPPG,
      gajiHarian: u.Gaji_Harian,
      statusAktif: isActive(u.Status_Aktif),
    })),
  };
}

async function getKaryawanForPayroll(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak");

  const users = (await getScopedUsers(session)).filter((u) => u.Role === "USER" && isActive(u.Status_Aktif));
  return {
    success: true,
    karyawan: users.map((u) => ({
      idUser: u.ID_User,
      namaLengkap: u.Nama_Lengkap,
      role: u.Role,
      jabatanDivisi: u.Jabatan_Divisi,
      gajiHarian: u.Gaji_Harian,
      sppg: u.SPPG,
      yayasan: u.Yayasan,
    })),
  };
}

interface KaryawanPayrollInput {
  idUser: string;
  bonus?: number;
  potongan?: number;
  keteranganPotongan?: string;
}

interface PayrollCalculation {
  user: Record<string, any>;
  attendanceIds: string[];
  jumlahHariKerja: number;
  tanggalKerja: string[];
  gajiHarian: number;
  subtotalGaji: number;
  bonus: number;
  potongan: number;
  keteranganPotongan: string;
  totalGaji: number;
}

function parseMoney(value: unknown, label: string): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) {
    throw new ApiError(`${label} harus berupa nominal valid antara 0 dan 1 miliar`);
  }
  return Math.round(amount);
}

function parsePayrollDate(value: unknown, label: string): string {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new ApiError(`${label} tidak valid`);
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new ApiError(`${label} tidak valid`);
  }
  return normalized;
}

function formatTanggalPdf(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00+07:00`);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTanggalWaktuPdf(value: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value).replace(/\./g, ":") + " WIB";
}

function formatRupiahPdf(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

function pdfSafeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}

function payrollSafePath(value: unknown): string {
  return String(value || "data")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "data";
}

function decodePngDataUrl(value: unknown): Uint8Array {
  const dataUrl = String(value || "");
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new ApiError("Tanda tangan wajib dibuat pada canvas dan dikirim dalam format PNG");
  const base64 = match[1].replace(/\s/g, "");
  if (base64.length > 1_500_000) throw new ApiError("Ukuran tanda tangan terlalu besar");
  try {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    if (bytes.length < 100 || bytes.length > 1_000_000) throw new Error("invalid size");
    if (
      bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 ||
      bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
    ) {
      throw new Error("invalid signature");
    }
    return bytes;
  } catch {
    throw new ApiError("Data tanda tangan tidak valid");
  }
}

function isCountedWorkDay(rows: Record<string, any>[]): boolean {
  const hasSingleValidPunch = rows.some((row) => row.Jenis_Absen === "PUNCH_TUNGGAL");
  const hasDatang = rows.some((row) => row.Jenis_Absen === "DATANG");
  const hasPulang = rows.some((row) => row.Jenis_Absen === "PULANG");
  return hasSingleValidPunch || (hasDatang && hasPulang);
}

async function buildPayrollSlipPdf(input: {
  idSlip: string;
  idPayroll: string;
  calculation: PayrollCalculation;
  signerName: string;
  issuedAt: Date;
  signatureBytes: Uint8Array;
}): Promise<Uint8Array> {
  const { idSlip, idPayroll, calculation, signerName, issuedAt, signatureBytes } = input;
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafeText(`Slip Gaji ${calculation.user.Nama_Lengkap || calculation.user.ID_User}`));
  pdf.setAuthor(pdfSafeText(`SPPG ${calculation.user.SPPG || ""}`));
  pdf.setSubject(`Slip gaji periode ${calculation.tanggalKerja[0] || ""}`);
  pdf.setCreator("Sistem Absensi dan Payroll SPPG");
  pdf.setCreationDate(issuedAt);
  pdf.setModificationDate(issuedAt);

  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const signature = await pdf.embedPng(signatureBytes);
  const navy = rgb(0.06, 0.12, 0.24);
  const blue = rgb(0.22, 0.27, 0.75);
  const muted = rgb(0.35, 0.4, 0.48);
  const border = rgb(0.87, 0.89, 0.93);
  const pale = rgb(0.96, 0.97, 0.99);
  const green = rgb(0.05, 0.45, 0.28);
  const left = 48;
  const right = 547;
  const contentWidth = right - left;

  page.drawRectangle({ x: 0, y: 758, width: 595.28, height: 83.89, color: navy });
  page.drawRectangle({ x: left, y: 774, width: 7, height: 46, color: blue });
  page.drawText("SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)", {
    x: left + 20, y: 801, size: 12, font: bold, color: rgb(1, 1, 1),
  });
  page.drawText(pdfSafeText(calculation.user.SPPG || "NAMA SPPG BELUM DIATUR").toUpperCase(), {
    x: left + 20, y: 780, size: 18, font: bold, color: rgb(1, 1, 1),
  });

  page.drawText("SLIP GAJI", { x: left, y: 726, size: 20, font: bold, color: navy });
  page.drawText(`No. ${idSlip}`, { x: left, y: 708, size: 9, font: regular, color: muted });
  page.drawText(`Batch ${idPayroll}`, { x: right - 180, y: 726, size: 9, font: regular, color: muted });
  page.drawText(`Terbit: ${formatTanggalWaktuPdf(issuedAt)}`, {
    x: right - 180, y: 708, size: 9, font: regular, color: muted,
  });

  page.drawRectangle({ x: left, y: 615, width: contentWidth, height: 70, color: pale, borderColor: border, borderWidth: 1 });
  const identityRows = [
    ["Nama", pdfSafeText(calculation.user.Nama_Lengkap || "-")],
    ["Jabatan / Divisi", pdfSafeText(calculation.user.Jabatan_Divisi || "-")],
    ["Periode", `${formatTanggalPdf(input.calculation.user._periodeMulai)} s.d. ${formatTanggalPdf(input.calculation.user._periodeAkhir)}`],
  ];
  identityRows.forEach(([label, value], index) => {
    const y = 663 - index * 20;
    page.drawText(label, { x: left + 14, y, size: 9, font: bold, color: muted });
    page.drawText(":", { x: left + 112, y, size: 9, font: regular, color: muted });
    page.drawText(value.slice(0, 74), { x: left + 126, y, size: 10, font: regular, color: navy });
  });

  page.drawText("RINCIAN PENGHASILAN", { x: left, y: 582, size: 10, font: bold, color: navy });
  page.drawRectangle({ x: left, y: 545, width: contentWidth, height: 27, color: navy });
  page.drawText("KOMPONEN", { x: left + 14, y: 555, size: 9, font: bold, color: rgb(1, 1, 1) });
  page.drawText("PERHITUNGAN", { x: left + 248, y: 555, size: 9, font: bold, color: rgb(1, 1, 1) });
  page.drawText("NOMINAL", { x: right - 76, y: 555, size: 9, font: bold, color: rgb(1, 1, 1) });

  const components = [
    ["Gaji pokok", `${formatRupiahPdf(calculation.gajiHarian)} x ${calculation.jumlahHariKerja} hari`, calculation.subtotalGaji],
    ["Bonus / Tambahan", "Penyesuaian manual", calculation.bonus],
    ["Potongan", calculation.keteranganPotongan || "Tidak ada keterangan", -calculation.potongan],
  ] as Array<[string, string, number]>;
  let rowY = 513;
  components.forEach(([label, detail, amount], index) => {
    if (index % 2 === 1) page.drawRectangle({ x: left, y: rowY - 12, width: contentWidth, height: 36, color: pale });
    page.drawText(label, { x: left + 14, y: rowY, size: 10, font: bold, color: navy });
    page.drawText(pdfSafeText(detail).slice(0, 40), { x: left + 248, y: rowY, size: 9, font: regular, color: muted });
    const nominal = amount < 0 ? `- ${formatRupiahPdf(Math.abs(amount))}` : formatRupiahPdf(amount);
    page.drawText(nominal, {
      x: right - 14 - regular.widthOfTextAtSize(nominal, 9), y: rowY, size: 9, font: regular, color: amount < 0 ? rgb(0.72, 0.12, 0.12) : navy,
    });
    page.drawLine({ start: { x: left, y: rowY - 13 }, end: { x: right, y: rowY - 13 }, thickness: 0.7, color: border });
    rowY -= 36;
  });

  page.drawRectangle({ x: left, y: 375, width: contentWidth, height: 54, color: rgb(0.92, 0.98, 0.95), borderColor: rgb(0.65, 0.89, 0.76), borderWidth: 1 });
  page.drawText("TOTAL GAJI DITERIMA", { x: left + 16, y: 396, size: 11, font: bold, color: green });
  const totalText = formatRupiahPdf(calculation.totalGaji);
  page.drawText(totalText, {
    x: right - 16 - bold.widthOfTextAtSize(totalText, 16), y: 392, size: 16, font: bold, color: green,
  });

  page.drawText("Dokumen ini diterbitkan secara elektronik oleh sistem payroll SPPG.", {
    x: left, y: 337, size: 8, font: regular, color: muted,
  });
  page.drawText(`Tanggal cetak: ${formatTanggalWaktuPdf(issuedAt)}`, {
    x: left, y: 322, size: 8, font: regular, color: muted,
  });

  const signatureWidth = 145;
  const signatureHeight = Math.min(72, signatureWidth * (signature.height / signature.width));
  const signX = right - 190;
  page.drawText("Diterbitkan oleh,", { x: signX, y: 305, size: 9, font: regular, color: navy });
  page.drawImage(signature, { x: signX, y: 215, width: signatureWidth, height: signatureHeight });
  page.drawLine({ start: { x: signX, y: 205 }, end: { x: right - 10, y: 205 }, thickness: 0.8, color: muted });
  page.drawText(pdfSafeText(signerName).slice(0, 36), { x: signX, y: 190, size: 10, font: bold, color: navy });
  page.drawText("ADMIN / PENERBIT", { x: signX, y: 176, size: 8, font: regular, color: muted });

  page.drawLine({ start: { x: left, y: 90 }, end: { x: right, y: 90 }, thickness: 0.7, color: border });
  page.drawText("Slip bersifat rahasia. Pastikan data dan nominal telah sesuai sebelum digunakan.", {
    x: left, y: 72, size: 8, font: regular, color: muted,
  });
  page.drawText("1 / 1", { x: right - 20, y: 72, size: 8, font: regular, color: muted });

  return await pdf.save({ useObjectStreams: false });
}

async function prosesPayroll(data: {
  token?: string;
  periodeMulai?: string;
  periodeAkhir?: string;
  karyawanData?: KaryawanPayrollInput[];
  tandaTanganBase64?: string;
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) {
    throw new ApiError("Akses ditolak. Hanya Admin atau Super Admin yang dapat menerbitkan slip.");
  }

  const { karyawanData, tandaTanganBase64 } = data;
  if (!karyawanData || karyawanData.length === 0) {
    throw new ApiError("Data payroll tidak lengkap");
  }
  if (karyawanData.length > 50) throw new ApiError("Maksimal 50 slip dapat diterbitkan dalam satu batch");
  const periodeMulai = parsePayrollDate(data.periodeMulai, "Tanggal mulai periode");
  const periodeAkhir = parsePayrollDate(data.periodeAkhir, "Tanggal akhir periode");
  const startMs = Date.parse(`${periodeMulai}T00:00:00Z`);
  const endMs = Date.parse(`${periodeAkhir}T00:00:00Z`);
  if (endMs < startMs) throw new ApiError("Tanggal akhir periode tidak boleh sebelum tanggal mulai");
  if ((endMs - startMs) / 86_400_000 > 366) throw new ApiError("Periode payroll maksimal 366 hari");
  const signatureBytes = decodePngDataUrl(tandaTanganBase64);
  const uniqueUserIds = [...new Set(karyawanData.map((row) => String(row.idUser || "").trim()).filter(Boolean))];
  if (uniqueUserIds.length !== karyawanData.length) throw new ApiError("Daftar karyawan berisi ID kosong atau duplikat");

  const scopedIds = await getScopedUserIdSet(session);
  if (uniqueUserIds.some((idUser) => !scopedIds.has(idUser))) {
    throw new ApiError("Akses ditolak: terdapat karyawan di luar SPPG Anda pada data payroll ini");
  }

  const { data: users, error: usersError } = await supabase
    .from("Users")
    .select("ID_User, Nama_Lengkap, Jabatan_Divisi, Gaji_Harian, SPPG, Yayasan, Role, Status_Aktif")
    .in("ID_User", uniqueUserIds);
  if (usersError) throw new Error("Gagal mengambil data karyawan: " + usersError.message);
  if ((users || []).length !== uniqueUserIds.length) throw new ApiError("Sebagian data karyawan tidak ditemukan");
  const userMap = new Map((users || []).map((user: any) => [user.ID_User, user]));
  for (const idUser of uniqueUserIds) {
    const user: any = userMap.get(idUser);
    if (!user || normalizeRole(user.Role) !== "USER" || !isActive(user.Status_Aktif)) {
      throw new ApiError("Slip hanya dapat diterbitkan untuk karyawan aktif");
    }
    if (parseMoney(user.Gaji_Harian, "Gaji harian") <= 0) {
      throw new ApiError(`Gaji harian ${user.Nama_Lengkap || idUser} belum diatur`);
    }
  }

  const { data: duplicates, error: duplicateError } = await supabase
    .from("Slip_Gaji")
    .select("ID_User")
    .in("ID_User", uniqueUserIds)
    .eq("Periode_Mulai", periodeMulai)
    .eq("Periode_Akhir", periodeAkhir)
    .eq("Status_Penerbitan", "DITERBITKAN");
  if (duplicateError) throw new Error("Gagal memeriksa slip lama: " + duplicateError.message);
  if ((duplicates || []).length) {
    const duplicateNames = (duplicates || []).map((row: any) => userMap.get(row.ID_User)?.Nama_Lengkap || row.ID_User);
    throw new ApiError(`Slip periode yang sama sudah diterbitkan untuk: ${duplicateNames.join(", ")}`);
  }

  const attendance = await selectAllRows(
    "Absensi",
    "ID_Absen, ID_User, Tanggal, Jenis_Absen, Status_Validasi, ID_Payroll",
    (query) => query
      .in("ID_User", uniqueUserIds)
      .eq("Status_Validasi", "VALID")
      .gte("Tanggal", periodeMulai)
      .lte("Tanggal", periodeAkhir),
  );

  const inputMap = new Map(karyawanData.map((row) => [String(row.idUser), row]));
  const calculations: PayrollCalculation[] = uniqueUserIds.map((idUser) => {
    const user: any = userMap.get(idUser);
    const input = inputMap.get(idUser)!;
    const userAttendance = attendance.filter((row) => row.ID_User === idUser && !row.ID_Payroll);
    const byDate = new Map<string, Record<string, any>[]>();
    userAttendance.forEach((row) => {
      const date = toDateStr(row.Tanggal);
      const rows = byDate.get(date) || [];
      rows.push(row);
      byDate.set(date, rows);
    });
    const tanggalKerja = [...byDate.entries()]
      .filter(([, rows]) => isCountedWorkDay(rows))
      .map(([date]) => date)
      .sort();
    const countedDates = new Set(tanggalKerja);
    const attendanceIds = userAttendance
      .filter((row) => countedDates.has(toDateStr(row.Tanggal)))
      .map((row) => row.ID_Absen);
    const gajiHarian = parseMoney(user.Gaji_Harian, "Gaji harian");
    const bonus = parseMoney(input.bonus, "Bonus / tambahan");
    const potongan = parseMoney(input.potongan, "Potongan");
    const subtotalGaji = gajiHarian * tanggalKerja.length;
    const totalGaji = subtotalGaji + bonus - potongan;
    if (totalGaji < 0) throw new ApiError(`Total gaji ${user.Nama_Lengkap || idUser} tidak boleh negatif`);
    return {
      user: { ...user, _periodeMulai: periodeMulai, _periodeAkhir: periodeAkhir },
      attendanceIds,
      jumlahHariKerja: tanggalKerja.length,
      tanggalKerja,
      gajiHarian,
      subtotalGaji,
      bonus,
      potongan,
      keteranganPotongan: String(input.keteranganPotongan || "").trim().slice(0, 300),
      totalGaji,
    };
  });

  const { data: signer, error: signerError } = await supabase
    .from("Users")
    .select("Nama_Lengkap, SPPG, Yayasan")
    .eq("ID_User", session.idUser)
    .maybeSingle();
  if (signerError) throw new Error("Gagal mengambil data penerbit: " + signerError.message);
  const signerName = String(signer?.Nama_Lengkap || "").trim();
  if (!signerName) throw new ApiError("Nama lengkap Admin wajib diisi sebelum menerbitkan slip");

  const idPayroll = generateId("PAY");
  const issuedAt = new Date();
  const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Jakarta", year: "numeric" }).format(issuedAt);
  const signaturePath = `${year}/${idPayroll}/ttd-penerbit.png`;
  const uploadedPdfPaths: string[] = [];
  let payrollInserted = false;

  try {
    const { error: signatureUploadError } = await supabase.storage
      .from("tanda-tangan")
      .upload(signaturePath, signatureBytes, { contentType: "image/png", upsert: false });
    if (signatureUploadError) throw new Error("Gagal menyimpan tanda tangan: " + signatureUploadError.message);

    const sppgList = [...new Set(calculations.map((item) => item.user.SPPG).filter(Boolean))];
    const yayasanList = [...new Set(calculations.map((item) => item.user.Yayasan).filter(Boolean))];
    const { error: payrollInsertError } = await supabase.from("Payroll").insert({
      ID_Payroll: idPayroll,
      Periode_Mulai: periodeMulai,
      Periode_Akhir: periodeAkhir,
      Diproses_Oleh: session.idUser,
      Tanda_Tangan_Digital_URL: signaturePath,
      Waktu_Proses: issuedAt.toISOString(),
      Jumlah_Karyawan: calculations.length,
      SPPG: sppgList.length === 1 ? sppgList[0] : "MULTI SPPG",
      Yayasan: yayasanList.length === 1 ? yayasanList[0] : "MULTI YAYASAN",
      Status_Penerbitan: "DIPROSES",
      Diterbitkan_At: null,
      Diterbitkan_Oleh: session.idUser,
      Nama_Penerbit: signerName,
    });
    if (payrollInsertError) throw new Error("Gagal menyimpan batch payroll: " + payrollInsertError.message);
    payrollInserted = true;

    const slipRows: Record<string, unknown>[] = [];
    const resultRows: Record<string, unknown>[] = [];
    for (const calculation of calculations) {
      const idSlip = generateId("SLIP");
      const pdfBytes = await buildPayrollSlipPdf({
        idSlip,
        idPayroll,
        calculation,
        signerName,
        issuedAt,
        signatureBytes,
      });
      const pdfPath = `${year}/${idPayroll}/${payrollSafePath(calculation.user.Nama_Lengkap)}-${idSlip}.pdf`;
      const { error: pdfUploadError } = await supabase.storage
        .from("slip-gaji")
        .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: false });
      if (pdfUploadError) throw new Error(`Gagal menyimpan PDF ${calculation.user.Nama_Lengkap}: ${pdfUploadError.message}`);
      uploadedPdfPaths.push(pdfPath);
      const digest = await crypto.subtle.digest("SHA-256", pdfBytes);
      const pdfSha256 = bytesToHex(new Uint8Array(digest));
      slipRows.push({
        ID_Slip: idSlip,
        ID_Payroll: idPayroll,
        ID_User: calculation.user.ID_User,
        Periode_Mulai: periodeMulai,
        Periode_Akhir: periodeAkhir,
        Jumlah_Hari_Kerja: calculation.jumlahHariKerja,
        Gaji_Harian: calculation.gajiHarian,
        Subtotal_Gaji: calculation.subtotalGaji,
        Lembur_Nominal: 0,
        Bonus: calculation.bonus,
        Potongan: calculation.potongan,
        Keterangan_Potongan: calculation.keteranganPotongan,
        Total_Gaji_Diterima: calculation.totalGaji,
        URL_PDF_Slip: "",
        PDF_Storage_Path: pdfPath,
        PDF_SHA256: pdfSha256,
        SPPG: calculation.user.SPPG,
        Yayasan: calculation.user.Yayasan,
        Status_Penerbitan: "DITERBITKAN",
        Diterbitkan_At: issuedAt.toISOString(),
        Diterbitkan_Oleh: session.idUser,
        Nama_Penerbit: signerName,
        Dicetak_At: issuedAt.toISOString(),
      });
      resultRows.push({
        idSlip,
        idUser: calculation.user.ID_User,
        namaLengkap: calculation.user.Nama_Lengkap,
        totalGaji: calculation.totalGaji,
      });
    }

    const { error: slipInsertError } = await supabase.from("Slip_Gaji").insert(slipRows);
    if (slipInsertError) throw new Error("Gagal menyimpan slip gaji: " + slipInsertError.message);

    const processedAttendanceIds = calculations.flatMap((item) => item.attendanceIds);
    if (processedAttendanceIds.length > 0) {
      const { error: updateAbsensiError } = await supabase
        .from("Absensi")
        .update({ ID_Payroll: idPayroll })
        .in("ID_Absen", processedAttendanceIds);
      if (updateAbsensiError) throw new Error("Gagal menandai absensi payroll: " + updateAbsensiError.message);
    }

    const { error: publishError } = await supabase
      .from("Payroll")
      .update({ Status_Penerbitan: "DITERBITKAN", Diterbitkan_At: issuedAt.toISOString() })
      .eq("ID_Payroll", idPayroll);
    if (publishError) throw new Error("Gagal menyelesaikan penerbitan payroll: " + publishError.message);

    await logAudit(
      "TERBITKAN_SLIP_GAJI",
      {
        idPayroll,
        periodeMulai,
        periodeAkhir,
        jumlahKaryawan: calculations.length,
        idUser: calculations.map((item) => item.user.ID_User),
      },
      session.idUser || null,
    );

    return {
      success: true,
      idPayroll,
      jumlahSlip: calculations.length,
      slip: resultRows,
      message: `${calculations.length} slip gaji berhasil diterbitkan`,
    };
  } catch (error) {
    if (uploadedPdfPaths.length) await supabase.storage.from("slip-gaji").remove(uploadedPdfPaths);
    await supabase.storage.from("tanda-tangan").remove([signaturePath]);
    if (payrollInserted) await supabase.from("Payroll").delete().eq("ID_Payroll", idPayroll);
    throw error;
  }
}

async function getMyPayroll(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak");

  const { data: slips } = await supabase
    .from("Slip_Gaji")
    .select("*")
    .eq("ID_User", session.idUser)
    .eq("Status_Penerbitan", "DITERBITKAN")
    .order("Diterbitkan_At", { ascending: false });
  const { data: me } = await supabase.from("Users").select("*").eq("ID_User", session.idUser).maybeSingle();

  return {
    success: true,
    namaLengkap: me ? me.Nama_Lengkap : "",
    jabatanDivisi: me ? me.Jabatan_Divisi : "",
    sppg: me ? me.SPPG : "",
    payroll: (slips || []).map((s) => ({
      idSlip: s.ID_Slip,
      idPayroll: s.ID_Payroll,
      periodeMulai: s.Periode_Mulai,
      periodeAkhir: s.Periode_Akhir,
      jumlahHariKerja: s.Jumlah_Hari_Kerja,
      gajiHarian: s.Gaji_Harian,
      subtotalGaji: s.Subtotal_Gaji,
      lembur: s.Lembur_Nominal,
      bonus: s.Bonus,
      potongan: s.Potongan,
      keteranganPotongan: s.Keterangan_Potongan,
      totalGaji: s.Total_Gaji_Diterima,
      statusPenerbitan: s.Status_Penerbitan,
      diterbitkanAt: s.Diterbitkan_At,
      namaPenerbit: s.Nama_Penerbit,
      dapatDiunduh: Boolean(s.PDF_Storage_Path || s.URL_PDF_Slip),
    })),
  };
}

async function getSlipDownloadUrl(data: { token?: string; idSlip?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak");
  const idSlip = String(data.idSlip || "").trim();
  if (!idSlip) throw new ApiError("ID slip tidak ditemukan");

  const { data: slip, error } = await supabase
    .from("Slip_Gaji")
    .select("ID_Slip, ID_User, Periode_Mulai, Periode_Akhir, PDF_Storage_Path, URL_PDF_Slip, Status_Penerbitan")
    .eq("ID_Slip", idSlip)
    .maybeSingle();
  if (error) throw new Error("Gagal mengambil slip: " + error.message);
  if (!slip || slip.Status_Penerbitan !== "DITERBITKAN") throw new ApiError("Slip belum tersedia");

  if (slip.ID_User !== session.idUser) {
    if (!isAdminRole(session.role)) throw new ApiError("Akses ditolak");
    const scopedIds = await getScopedUserIdSet(session);
    if (!scopedIds.has(slip.ID_User)) throw new ApiError("Slip berada di luar cakupan SPPG Anda");
  }

  const storagePath = String(slip.PDF_Storage_Path || "").trim();
  if (storagePath) {
    const filename = `slip-gaji-${payrollSafePath(slip.Periode_Mulai)}-${payrollSafePath(slip.Periode_Akhir)}.pdf`;
    const { data: signed, error: signedError } = await supabase.storage
      .from("slip-gaji")
      .createSignedUrl(storagePath, 300, { download: filename });
    if (signedError || !signed?.signedUrl) throw new Error("Gagal membuat tautan unduhan slip");
    await logAudit("UNDUH_SLIP_GAJI", { idSlip }, session.idUser || null);
    return { success: true, url: signed.signedUrl, filename, expiresIn: 300 };
  }

  const legacyUrl = String(slip.URL_PDF_Slip || "");
  if (legacyUrl.startsWith("https://")) {
    return { success: true, url: legacyUrl, filename: `slip-gaji-${idSlip}.pdf`, expiresIn: 0 };
  }
  throw new ApiError("File PDF slip belum tersedia");
}

async function getAbsensiForPayrollPreview(data: {
  token?: string;
  periodeMulai?: string;
  periodeAkhir?: string;
  idUserList?: string[];
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !canManageOperations(session.role)) throw new ApiError("Akses ditolak");

  const { periodeMulai, periodeAkhir, idUserList } = data;
  if (!periodeMulai || !periodeAkhir || !idUserList || idUserList.length === 0) {
    return { absensiPerUser: {} };
  }

  const mulaiStr = toDateStr(periodeMulai);
  const akhirStr = toDateStr(periodeAkhir);

  const scopedIds = await getScopedUserIdSet(session);
  const uniqueIds = [...new Set(idUserList.map((id) => String(id || "").trim()).filter(Boolean))];
  if (uniqueIds.length > 50) throw new ApiError("Maksimal 50 karyawan dapat dipratinjau");
  if (uniqueIds.some((id) => !scopedIds.has(id))) throw new ApiError("Terdapat karyawan di luar cakupan SPPG Anda");

  const allAbsensi = await selectAllRows(
    "Absensi",
    "ID_User, Tanggal, Jenis_Absen, Status_Validasi, ID_Payroll",
    (q) => q
      .in("ID_User", uniqueIds)
      .eq("Status_Validasi", "VALID")
      .gte("Tanggal", mulaiStr)
      .lte("Tanggal", akhirStr),
  );
  const result: Record<string, { jumlahHariKerja: number; tanggalKerja: string[] }> = {};

  uniqueIds.forEach((idUser) => {
    const userAbsensi = allAbsensi.filter((a) => {
      if (a.ID_User !== idUser) return false;
      if (a.ID_Payroll) return false;
      const tStr = toDateStr(a.Tanggal);
      return tStr >= mulaiStr && tStr <= akhirStr;
    });

    const byDate: Record<string, Record<string, any>[]> = {};
    userAbsensi.forEach((a) => {
      const tStr = toDateStr(a.Tanggal);
      if (!byDate[tStr]) byDate[tStr] = [];
      byDate[tStr].push(a);
    });

    const tanggalKerja = Object.keys(byDate)
      .filter((date) => isCountedWorkDay(byDate[date]))
      .sort();

    result[idUser] = { jumlahHariKerja: tanggalKerja.length, tanggalKerja };
  });

  return { absensiPerUser: result };
}

interface CrudConfig {
  table: string;
  pk: string;
  scoped: "direct" | "byUser" | false;
}

const CRUD_CONFIG: Record<string, CrudConfig> = {
  users: { table: "Users", pk: "ID_User", scoped: "direct" },
  absensi: { table: "Absensi", pk: "ID_Absen", scoped: "byUser" },
  payroll: { table: "Payroll", pk: "ID_Payroll", scoped: "byUser" },
  slip_gaji: { table: "Slip_Gaji", pk: "ID_Slip", scoped: "byUser" },
  pengaduan: { table: "Pengaduan", pk: "ID_Pengaduan", scoped: "byUser" },
  device: { table: "Device_Absen", pk: "ID_Device", scoped: false },
  master_sppg: { table: "Master_SPPG", pk: "ID_Master_SPPG", scoped: false },
  master_jabatan: { table: "Master_Jabatan", pk: "ID_Master_Jabatan", scoped: false },
};

const CRUD_FORBIDDEN_FIELDS: Record<string, string[]> = {
  users: ["ID_User", "Password_Hash", "Password_Salt", "Face_Descriptor_JSON", "Created_At"],
  absensi: ["ID_Absen", "Created_At"],
  payroll: ["ID_Payroll", "Created_At"],
  slip_gaji: ["ID_Slip", "Created_At"],
  pengaduan: ["ID_Pengaduan"],
  device: ["ID_Device", "Password_Hash", "Password_Salt"],
  master_sppg: ["ID_Master_SPPG"],
  master_jabatan: ["ID_Master_Jabatan"],
};

const CRUD_ROLE_RESTRICTED_FIELDS: Record<string, Record<string, string[]>> = {
  users: {
    Role: ["ADMIN", "SUPER ADMIN"],
    Gaji_Harian: ["ADMIN", "SUPER ADMIN"],
    Status_Aktif: ["ADMIN", "SUPER ADMIN"],
  },
  absensi: {
    Skor_Kecocokan_Wajah: ["ADMIN", "SUPER ADMIN"],
    Status_Validasi: ["ADMIN", "SUPER ADMIN"],
  },
  slip_gaji: {
    Gaji_Harian: ["ADMIN", "SUPER ADMIN"],
    Subtotal_Gaji: ["ADMIN", "SUPER ADMIN"],
    Lembur_Nominal: ["ADMIN", "SUPER ADMIN"],
    Bonus: ["ADMIN", "SUPER ADMIN"],
    Potongan: ["ADMIN", "SUPER ADMIN"],
    Total_Gaji_Diterima: ["ADMIN", "SUPER ADMIN"],
  },
  payroll: {
    Jumlah_Karyawan: ["ADMIN", "SUPER ADMIN"],
  },
};

async function requireAdminOrAkuntan(token: string): Promise<SessionData> {
  const session = await validateSession(token);
  if (session.type !== "user" || !canManageOperations(session.role)) {
    throw new ApiError("Akses ditolak. Hanya untuk Admin atau Akuntan.");
  }
  return session;
}

async function findRowByMenuId(menu: string, id: string): Promise<{ cfg: CrudConfig; row: Record<string, any> }> {
  const cfg = CRUD_CONFIG[menu];
  if (!cfg) throw new ApiError("Menu tidak dikenali: " + menu);

  const { data: row, error } = await supabase.from(cfg.table).select("*").eq(cfg.pk, id).maybeSingle();
  if (error || !row) throw new ApiError("Data tidak ditemukan");

  return { cfg, row };
}

async function canAccessRow(session: SessionData, menu: string, row: Record<string, any>): Promise<boolean> {
  if (isSuperAdmin(session.role)) return true;

  const cfg = CRUD_CONFIG[menu];
  const scopedUserIds = await getScopedUserIdSet(session);

  if (menu === "users") return scopedUserIds.has(row.ID_User);
  if (cfg.scoped === "byUser") return scopedUserIds.has(row.ID_User);
  return false;
}

function summarizeRowForAudit(menu: string, row: Record<string, any>): Record<string, unknown> {
  switch (menu) {
    case "users":
      return { nama: row.Nama_Lengkap, email: row.Email, role: row.Role };
    case "absensi":
      return { idUser: row.ID_User, tanggal: row.Tanggal, jenis: row.Jenis_Absen };
    case "payroll":
      return { idPayroll: row.ID_Payroll, periode: row.Periode_Mulai };
    case "slip_gaji":
      return { idSlip: row.ID_Slip, idUser: row.ID_User };
    case "pengaduan":
      return { idUser: row.ID_User, subjek: row.Subjek || row.Judul };
    case "device":
      return { namaDevice: row.Nama_Device, sppg: row.Lokasi_SPPG };
    case "master_sppg":
      return { namaSppg: row.Nama_SPPG };
    case "master_jabatan":
      return { namaJabatan: row.Nama_Jabatan };
    default:
      return {};
  }
}

async function updateData(reqData: { token?: string; menu?: string; id?: string; data?: Record<string, any> }): Promise<unknown> {
  const { token, menu, id, data } = reqData || {};
  if (!menu || !id) throw new ApiError("Menu dan ID wajib diisi");

  const session = await requireAdminOrAkuntan(token || "");
  const { cfg, row } = await findRowByMenuId(menu, id);

  if (!(await canAccessRow(session, menu, row))) {
    throw new ApiError("Akses ditolak. Data ini di luar cakupan akun Anda.");
  }

  const forbidden = CRUD_FORBIDDEN_FIELDS[menu] || [];
  const roleRestricted = CRUD_ROLE_RESTRICTED_FIELDS[menu] || {};
  const updatePayload: Record<string, any> = {};
  const perubahan: { field: string; dari: any; ke: any }[] = [];
  const fieldDitolakRole: string[] = [];

  Object.keys(data || {}).forEach((field) => {
    if (forbidden.indexOf(field) !== -1) return;
    if (roleRestricted[field] && roleRestricted[field].indexOf(session.role || "") === -1) {
      fieldDitolakRole.push(field);
      return;
    }
    const nilaiLama = row[field];
    const nilaiBaru = data![field];
    if (String(nilaiLama) !== String(nilaiBaru)) {
      perubahan.push({ field, dari: nilaiLama, ke: nilaiBaru });
    }
    updatePayload[field] = nilaiBaru;
  });

  if (Object.prototype.hasOwnProperty.call(row, "Updated_At")) {
    updatePayload["Updated_At"] = new Date().toISOString();
  }

  const { error: updateError } = await supabase.from(cfg.table).update(updatePayload).eq(cfg.pk, id);
  if (updateError) throw new Error("Gagal memperbarui data: " + updateError.message);

  const detailLog: Record<string, unknown> = { menu, id, perubahan };
  if (fieldDitolakRole.length > 0) detailLog.fieldDitolakRole = fieldDitolakRole;

  await logAudit("EDIT_DATA_" + menu.toUpperCase(), detailLog, session.idUser || null);

  return { success: true, message: "Data berhasil diperbarui" };
}

async function deleteData(reqData: { token?: string; menu?: string; id?: string }): Promise<unknown> {
  const { token, menu, id } = reqData || {};
  if (!menu || !id) throw new ApiError("Menu dan ID wajib diisi");

  const session = await requireAdminOrAkuntan(token || "");
  const { cfg, row } = await findRowByMenuId(menu, id);

  if (!(await canAccessRow(session, menu, row))) {
    throw new ApiError("Akses ditolak. Data ini di luar cakupan akun Anda.");
  }

  const { error: deleteError } = await supabase.from(cfg.table).delete().eq(cfg.pk, id);
  if (deleteError) throw new Error("Gagal menghapus data: " + deleteError.message);

  await logAudit(
    "DELETE_DATA_" + menu.toUpperCase(),
    { menu, id, ringkasanData: summarizeRowForAudit(menu, row) },
    session.idUser || null,
  );

  return { success: true, message: "Data berhasil dihapus" };
}

async function deleteMultipleData(reqData: { token?: string; menu?: string; ids?: string[] }): Promise<unknown> {
  const { token, menu, ids } = reqData || {};
  if (!Array.isArray(ids) || ids.length === 0) throw new ApiError("Tidak ada data yang dipilih untuk dihapus");

  const session = await requireAdminOrAkuntan(token || "");
  const cfg = CRUD_CONFIG[menu || ""];
  if (!cfg) throw new ApiError("Menu tidak dikenali: " + menu);

  const hasilPerItem: { id: string; success: boolean; message?: string }[] = [];
  let jumlahBerhasil = 0;

  for (const id of ids) {
    try {
      const found = await findRowByMenuId(menu!, id);
      if (!(await canAccessRow(session, menu!, found.row))) {
        throw new Error("Di luar cakupan akun Anda");
      }
      const { error: deleteError } = await supabase.from(cfg.table).delete().eq(cfg.pk, id);
      if (deleteError) throw new Error(deleteError.message);

      await logAudit(
        "DELETE_DATA_" + menu!.toUpperCase(),
        { menu, id, batchDelete: true, ringkasanData: summarizeRowForAudit(menu!, found.row) },
        session.idUser || null,
      );
      hasilPerItem.push({ id, success: true });
      jumlahBerhasil++;
    } catch (e) {
      hasilPerItem.push({ id, success: false, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    success: jumlahBerhasil > 0,
    jumlahBerhasil,
    jumlahGagal: ids.length - jumlahBerhasil,
    hasilPerItem,
    message: `${jumlahBerhasil} dari ${ids.length} data berhasil dihapus`,
  };
}

async function enrichPayrollList(payrollList: Record<string, any>[], users: Record<string, any>[]): Promise<Record<string, any>[]> {
  return payrollList.map((p) => {
    const admin = users.find((u) => u.ID_User === p.Diproses_Oleh);
    return {
      ...p,
      _diprosesOlehNama: admin ? admin.Nama_Lengkap : p.Diproses_Oleh,
      _diprosesOlehEmail: admin ? admin.Email : "",
    };
  });
}

async function getAllPayrollHistory(data: { token?: string }): Promise<unknown> {
  const session = await requireAdminOrAkuntan(data?.token || "");

  const { data: payrollList } = await supabase.from("Payroll").select("*");
  const { data: users } = await supabase.from("Users").select("*");

  if (isSuperAdmin(session.role)) {
    return { success: true, payroll: await enrichPayrollList(payrollList || [], users || []) };
  }

  const scopedIds = await getScopedUserIdSet(session);
  const { data: slipGaji } = await supabase.from("Slip_Gaji").select("*");
  const payrollIdsScoped = new Set((slipGaji || []).filter((s) => scopedIds.has(s.ID_User)).map((s) => s.ID_Payroll));
  const filtered = (payrollList || []).filter((p) => payrollIdsScoped.has(p.ID_Payroll));

  return { success: true, payroll: await enrichPayrollList(filtered, users || []) };
}

async function getAllSlipGajiList(data: { token?: string }): Promise<unknown> {
  const session = await requireAdminOrAkuntan(data?.token || "");

  const scopedIds = await getScopedUserIdSet(session);
  const { data: users } = await supabase.from("Users").select("*");
  let { data: slipGaji } = await supabase.from("Slip_Gaji").select("*");
  slipGaji = slipGaji || [];

  if (!isSuperAdmin(session.role)) {
    slipGaji = slipGaji.filter((s) => scopedIds.has(s.ID_User));
  }

  const enriched = slipGaji.map((s) => {
    const u = (users || []).find((usr) => usr.ID_User === s.ID_User);
    return { ...s, _namaKaryawan: u ? u.Nama_Lengkap : s.ID_User, _sppgKaryawan: u ? u.SPPG : "" };
  });

  return { success: true, slipGaji: enriched };
}

async function requireSuperAdmin(token: string): Promise<SessionData> {
  const session = await validateSession(token);
  if (session.type !== "user" || session.role !== "SUPER ADMIN") {
    throw new ApiError("Akses ditolak. Hanya untuk Super Admin.");
  }
  return session;
}

async function getAksesEmailList(data: { token?: string }): Promise<unknown> {
  await requireSuperAdmin(data?.token || "");
  const { data: list, error } = await supabase.from("Akses_Email").select("*").order("Email", { ascending: true });
  if (error) throw new Error("Gagal mengambil data Akses_Email: " + error.message);
  const yayasanMap = await getSppgYayasanMap();
  const enriched = (list || []).map((r: any) => ({ ...r, Yayasan: yayasanMap[r.SPPG] || "" }));
  return { success: true, aksesEmail: enriched };
}

async function saveAksesEmail(data: { token?: string; email?: string; sppg?: string; aktif?: boolean }): Promise<unknown> {
  await requireSuperAdmin(data?.token || "");
  const email = (data.email || "").trim().toLowerCase();
  const sppg = (data.sppg || "").trim();
  if (!email) throw new ApiError("Email wajib diisi");
  if (!sppg) throw new ApiError("SPPG wajib dipilih");

  const { error } = await supabase.from("Akses_Email").insert({
    Email: email,
    SPPG: sppg,
    Aktif: data.aktif !== false,
  });
  if (error) throw new Error("Gagal menyimpan Akses_Email: " + error.message);
  return { success: true, message: "Akses berhasil ditambahkan" };
}

async function deleteAksesEmail(data: { token?: string; idAkses?: string }): Promise<unknown> {
  await requireSuperAdmin(data?.token || "");
  if (!data.idAkses) throw new ApiError("ID Akses wajib diisi");
  const { error } = await supabase.from("Akses_Email").delete().eq("ID_Akses", data.idAkses);
  if (error) throw new Error("Gagal menghapus Akses_Email: " + error.message);
  return { success: true, message: "Akses berhasil dihapus" };
}


async function getAllMasterSppgList(data: { token?: string }): Promise<unknown> {
  await requireAdminOrAkuntan(data?.token || "");
  const { data: list, error } = await supabase.from("Master_SPPG").select("*");
  if (error) throw new Error("Gagal mengambil Master SPPG: " + error.message);
  return { success: true, masterSppg: list || [] };
}

async function getAllMasterJabatanList(data: { token?: string }): Promise<unknown> {
  await requireAdminOrAkuntan(data?.token || "");
  const { data: list, error } = await supabase.from("Master_Jabatan").select("*");
  if (error) throw new Error("Gagal mengambil Master Jabatan: " + error.message);
  return { success: true, masterJabatan: list || [] };
}

interface AuditLogFilters {
  jenisAktivitas?: string;
  tanggal?: string;
  pelaku?: string;
}

async function getAuditLog(data: { token?: string; filters?: AuditLogFilters }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak");

  const { data: logsRaw, error } = await supabase.from("Audit_Log").select("*").order("Waktu", { ascending: false }).limit(2000);
  if (error) throw new Error("Gagal mengambil audit log: " + error.message);

  let logs = logsRaw || [];
  const filters = data.filters;
  if (filters) {
    if (filters.jenisAktivitas) logs = logs.filter((l) => l.Jenis_Aktivitas === filters.jenisAktivitas);
    if (filters.tanggal) {
      const fStr = toDateStr(filters.tanggal);
      logs = logs.filter((l) => toDateStr(l.Waktu) === fStr);
    }
    if (filters.pelaku) logs = logs.filter((l) => l.ID_User_Pelaku === filters.pelaku);
  }

  return { success: true, logs };
}

async function getAuditLogEnriched(data: { token?: string; filters?: AuditLogFilters }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak");

  const { data: logsRaw, error } = await supabase.from("Audit_Log").select("*").order("Waktu", { ascending: false }).limit(2000);
  if (error) throw new Error("Gagal mengambil audit log: " + error.message);

  let logs = logsRaw || [];
  const filters = data.filters;
  if (filters) {
    if (filters.jenisAktivitas) logs = logs.filter((l) => l.Jenis_Aktivitas === filters.jenisAktivitas);
    if (filters.tanggal) {
      const fStr = toDateStr(filters.tanggal);
      logs = logs.filter((l) => toDateStr(l.Waktu) === fStr);
    }
    if (filters.pelaku) logs = logs.filter((l) => l.ID_User_Pelaku === filters.pelaku);
  }

  const { data: users } = await supabase.from("Users").select("*");
  const enriched = logs.map((l) => {
    const pelaku = (users || []).find((u) => u.ID_User === l.ID_User_Pelaku);
    return {
      ...l,
      _pelakuNama: pelaku ? pelaku.Nama_Lengkap : l.ID_User_Pelaku === "SYSTEM" ? "Sistem" : l.ID_User_Pelaku,
      _pelakuEmail: pelaku ? pelaku.Email : "",
    };
  });

  return { success: true, logs: enriched };
}

async function getProfilLengkap(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak");

  const { data: user } = await supabase.from("Users").select("*").eq("ID_User", session.idUser).maybeSingle();
  if (!user) throw new ApiError("User tidak ditemukan");

  return { success: true, user: sanitizeUser(user) };
}

async function updateProfil(data: { token?: string; updates?: Record<string, any> }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak");

  const allowedFields = [
    "Nama_Lengkap",
    "Tempat_Lahir",
    "Tanggal_Lahir",
    "Jenis_Kelamin",
    "Email",
    "No_Whatsapp",
    "Nama_Bank",
    "Nomor_Rekening",
    "Atas_Nama_Rekening",
  ];

  const updates = data.updates || {};
  const updatePayload: Record<string, any> = {};
  allowedFields.forEach((f) => {
    if (updates[f] !== undefined) updatePayload[f] = updates[f];
  });
  updatePayload["Updated_At"] = new Date().toISOString();

  const { error } = await supabase.from("Users").update(updatePayload).eq("ID_User", session.idUser);
  if (error) throw new Error("Gagal memperbarui profil: " + error.message);

  await logAudit("UPDATE_PROFIL", { idUser: session.idUser }, session.idUser || null);
  return { success: true, message: "Profil berhasil diperbarui" };
}

async function getAllUsers(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak");

  const users = await getScopedUsers(session);
  return { success: true, users: users.map((u) => sanitizeUser(u)) };
}

async function toggleUserStatus(data: { token?: string; idUser?: string; status?: boolean }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak");

  const { idUser, status } = data;
  if (!idUser) throw new ApiError("ID User wajib diisi");

  const { error } = await supabase
    .from("Users")
    .update({ Status_Aktif: status, Updated_At: new Date().toISOString() })
    .eq("ID_User", idUser);
  if (error) throw new Error("Gagal mengubah status user: " + error.message);

  await logAudit("TOGGLE_STATUS_USER", { idUser, newStatus: status }, session.idUser || null);
  return { success: true, message: "Status user diperbarui" };
}

async function updateFaceDescriptor(data: {
  token?: string;
  faceDescriptor?: unknown;
  fotoWajahBase64?: string;
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak");

  let fotoWajahUrl = "";
  if (data.fotoWajahBase64) {
    fotoWajahUrl = await uploadBase64ToStorage(
      "data-wajah-ref",
      `${session.idUser}/wajah_ref_${Date.now()}.png`,
      data.fotoWajahBase64,
      "image/png",
    );
  }

  const updatePayload: Record<string, any> = {
    Face_Descriptor_JSON: data.faceDescriptor ?? null,
    Updated_At: new Date().toISOString(),
  };
  if (fotoWajahUrl) updatePayload["URL_Foto_Wajah_Ref"] = fotoWajahUrl;

  const { error } = await supabase.from("Users").update(updatePayload).eq("ID_User", session.idUser);
  if (error) throw new Error("Gagal memperbarui data wajah: " + error.message);

  await logAudit("UPDATE_WAJAH", { idUser: session.idUser }, session.idUser || null);
  return { success: true, message: "Data wajah berhasil diperbarui" };
}

async function updateFotoProfil(data: {
  token?: string;
  fotoProfilBase64?: string;
  fotoProfilOriginalBase64?: string;
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak");
  if (!data.fotoProfilBase64) throw new ApiError("Foto tidak ditemukan");

  const fotoUrl = await uploadBase64ToStorage(
    "foto-profil",
    `${session.idUser}/foto_${Date.now()}.png`,
    data.fotoProfilBase64,
    "image/png",
  );

  let fotoOriUrl = "";
  if (data.fotoProfilOriginalBase64) {
    fotoOriUrl = await uploadBase64ToStorage(
      "foto-profil",
      `${session.idUser}/foto_asli_${Date.now()}.jpg`,
      data.fotoProfilOriginalBase64,
      "image/jpeg",
    );
  }

  const updatePayload: Record<string, any> = {
    URL_Foto_Profil: fotoUrl,
    Updated_At: new Date().toISOString(),
  };
  if (fotoOriUrl) updatePayload["URL_Foto_Profil_Asli"] = fotoOriUrl;

  const { error } = await supabase.from("Users").update(updatePayload).eq("ID_User", session.idUser);
  if (error) throw new Error("Gagal memperbarui foto profil: " + error.message);

  await logAudit("UPDATE_FOTO_PROFIL", { idUser: session.idUser }, session.idUser || null);
  return { success: true, message: "Foto profil berhasil diperbarui", url: fotoUrl, urlAsli: fotoOriUrl };
}

async function getDashboardData(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type === "device") throw new ApiError("Akses ditolak untuk perangkat absen");

  if (canManageOperations(session.role)) {
    return getDashboardAdmin(session);
  }
  return getDashboardUser(session.idUser!);
}

async function getDashboardAdmin(session: SessionData): Promise<unknown> {
  const scopedIds = await getScopedUserIdSet(session);
  const users = (await getScopedUsers(session)).filter((u) => normalizeRole(u.Role) === "USER" && isActive(u.Status_Aktif));
  const employeeIds = new Set(users.map((u) => u.ID_User));

  const allAbsensi = await selectAllRows("Absensi");
  const absensi = allAbsensi.filter((a) => scopedIds.has(a.ID_User) && employeeIds.has(a.ID_User));

  const todayStr = toDateStr(new Date());
  const todayAbsensi = absensi.filter((a) => toDateStr(a.Tanggal) === todayStr);

  const datangCount = todayAbsensi.filter((a) => a.Jenis_Absen === "DATANG" && a.Status_Validasi === "VALID").length;
  const pulangCount = todayAbsensi.filter((a) => a.Jenis_Absen === "PULANG" && a.Status_Validasi === "VALID").length;

  const sppgData: Record<string, number> = {};
  const jabatanData: Record<string, number> = {};
  users.forEach((u) => {
    sppgData[u.SPPG] = (sppgData[u.SPPG] || 0) + 1;
    jabatanData[u.Jabatan_Divisi] = (jabatanData[u.Jabatan_Divisi] || 0) + 1;
  });

  const absenUserIds = new Set(todayAbsensi.filter((a) => a.Status_Validasi === "VALID").map((a) => a.ID_User));
  const belumAbsen = users
    .filter((u) => !absenUserIds.has(u.ID_User))
    .map((u) => ({ nama: u.Nama_Lengkap, jabatan: u.Jabatan_Divisi, sppg: u.SPPG }));

  const { data: allSlipGaji } = await supabase.from("Slip_Gaji").select("*");
  const slipGaji = (allSlipGaji || []).filter((s) => scopedIds.has(s.ID_User));
  const thisMonth = new Date().toISOString().substring(0, 7);
  const payrollBulanIni = slipGaji.filter((s) => toDateStr(s.Periode_Mulai).substring(0, 7) === thisMonth);

  const trend: { tanggal: string; datang: number; pulang: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dStr = toDateStr(d);
    const dayAbsen = absensi.filter((a) => toDateStr(a.Tanggal) === dStr && a.Status_Validasi === "VALID");
    trend.push({
      tanggal: dStr,
      datang: dayAbsen.filter((a) => a.Jenis_Absen === "DATANG").length,
      pulang: dayAbsen.filter((a) => a.Jenis_Absen === "PULANG").length,
    });
  }

  return {
    role: "ADMIN",
    totalKaryawan: users.length,
    datangHariIni: datangCount,
    pulangHariIni: pulangCount,
    belumAbsen,
    sppgData,
    jabatanData,
    payrollBulanIni: payrollBulanIni.length,
    trend7Hari: trend,
  };
}

async function getDashboardUser(idUser: string): Promise<unknown> {
  const allAbsensi = await selectAllRows("Absensi", "*", (q) => q.eq("ID_User", idUser).eq("Status_Validasi", "VALID"));
  const absensi = allAbsensi;
  const { data: slipGaji } = await supabase.from("Slip_Gaji").select("*").eq("ID_User", idUser);

  const byDate: Record<string, { datang: boolean; pulang: boolean }> = {};
  absensi.forEach((a) => {
    const tStr = toDateStr(a.Tanggal);
    if (!byDate[tStr]) byDate[tStr] = { datang: false, pulang: false };
    if (a.Jenis_Absen === "DATANG") byDate[tStr].datang = true;
    if (a.Jenis_Absen === "PULANG") byDate[tStr].pulang = true;
  });

  const totalHariKerja = Object.values(byDate).filter((d) => d.datang && d.pulang).length;
  const totalSlip = (slipGaji || []).length;
  const totalGajiDiterima = (slipGaji || []).reduce((sum, s) => sum + (parseFloat(s.Total_Gaji_Diterima) || 0), 0);

  const riwayat = absensi
    .sort((a, b) => new Date(b.Waktu_Timestamp).getTime() - new Date(a.Waktu_Timestamp).getTime())
    .slice(0, 10)
    .map((a) => ({
      tanggal: toDateStr(a.Tanggal),
      jenis: a.Jenis_Absen,
      waktu: toJakartaTime(a.Waktu_Timestamp) || "-",
      status: a.Status_Validasi,
    }));

  const todayStr = toDateStr(new Date());
  const todayAbsen = absensi.filter((a) => toDateStr(a.Tanggal) === todayStr);

  return {
    role: "USER",
    totalHariKerja,
    totalSlip,
    totalGajiDiterima,
    riwayat,
    sudahDatang: todayAbsen.some((a) => a.Jenis_Absen === "DATANG"),
    sudahPulang: todayAbsen.some((a) => a.Jenis_Absen === "PULANG"),
  };
}

function generateIdPengaduan(): string {
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return "PGD_" + Date.now() + "_" + rand;
}

async function kirimPengaduan(data: {
  token?: string;
  Kategori?: string;
  Isi_Pengaduan?: string;
  Jenis_Pengirim?: string;
}): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || normalizeRole(session.role) !== "USER") {
    throw new ApiError("Akses ditolak. Menu pengaduan tersedia untuk pengguna.");
  }

  const { Kategori, Isi_Pengaduan, Jenis_Pengirim } = data;
  const isi = Isi_Pengaduan?.toString().trim() || "";
  const kategori = Kategori?.toString().trim() || "";
  if (isi.length < 10) throw new ApiError("Isi pengaduan minimal 10 karakter agar dapat ditindaklanjuti.");
  if (isi.length > 5000) throw new ApiError("Isi pengaduan maksimal 5.000 karakter.");
  if (!kategori) throw new ApiError("Kategori pengaduan tidak boleh kosong.");
  if (kategori.length > 100) throw new ApiError("Kategori pengaduan terlalu panjang.");

  const isAnonymous = String(Jenis_Pengirim || "").trim().toUpperCase() === "ANONYMOUS";
  let userPengirim = "Anonymous";

  const { data: pengirimUser } = await supabase
    .from("Users")
    .select("ID_User, Nama_Lengkap, ID_Card_Unik, SPPG, Yayasan")
    .eq("ID_User", session.idUser)
    .maybeSingle();

  if (!isAnonymous) {
    userPengirim = pengirimUser
      ? `${pengirimUser.Nama_Lengkap || ""} (${pengirimUser.ID_Card_Unik || ""})`
      : session.idUser || "";
  }

  const idPengaduan = generateIdPengaduan();
  const { error } = await supabase.from("Pengaduan").insert({
    ID_Pengaduan: idPengaduan,
    Timestamp: new Date().toISOString(),
    Kategori: kategori,
    Isi_Pengaduan: isi,
    Jenis_Pengirim: isAnonymous ? "Anonymous" : "Terdaftar",
    User_Pengirim: userPengirim,
    User: session.idUser,
    Status_Baca: "Belum Dibaca",
    Ditandai_Oleh: "",
    Waktu_Dibaca: null,
    Tanggapan_Admin: "",
    SPPG: pengirimUser?.SPPG || null,
    Yayasan: pengirimUser?.Yayasan || null,
    Ditanggapi_Oleh: null,
    Waktu_Tanggapan: null,
  });
  if (error) throw new Error("Gagal mengirim pengaduan: " + error.message);

  await logAudit(
    "KIRIM_PENGADUAN",
    { idPengaduan, kategori, jenisPengirim: isAnonymous ? "Anonymous" : "Terdaftar" },
    isAnonymous ? null : session.idUser || null,
  );

  return { success: true, idPengaduan };
}

async function getNotifikasiAdmin(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak. Hanya Admin.");

  const rowsRaw = await selectAllRows("Pengaduan", "Status_Baca, User");

  const scopedIds = isSuperAdmin(session.role) ? null : await getScopedUserIdSet(session);
  const rows = rowsRaw.filter((row) => !scopedIds || scopedIds.has(row.User));

  const jumlah = rows.filter((r) => r.Status_Baca === "Belum Dibaca").length;
  return { success: true, jumlah };
}

async function getDaftarPengaduan(data: { token?: string; filters?: { status?: string; kategori?: string } }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak. Hanya Admin.");

  const rowsRaw = await selectAllRows("Pengaduan");

  const scopedIds = isSuperAdmin(session.role) ? null : await getScopedUserIdSet(session);
  let rows = rowsRaw.filter((row) => !scopedIds || scopedIds.has(row.User));
  const filters = data.filters;
  if (filters?.status) rows = rows.filter((r) => r.Status_Baca === filters.status);
  if (filters?.kategori) rows = rows.filter((r) => r.Kategori === filters.kategori);

  rows.sort((a, b) => new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime());

  const senderIds = [...new Set(rows.map((r) => r.User).filter(Boolean))];
  const { data: senders } = senderIds.length
    ? await supabase.from("Users").select("ID_User, Nama_Lengkap, Email, ID_Card_Unik, SPPG, Jabatan_Divisi").in("ID_User", senderIds)
    : { data: [] as any[] };
  const senderMap = new Map((senders || []).map((u: any) => [u.ID_User, u]));

  const sanitized = rows.map((r) => {
    const obj = { ...r };
    const sender: any = senderMap.get(obj.User);
    if (obj.Jenis_Pengirim === "Anonymous" && !isSuperAdmin(session.role)) {
      obj.User_Pengirim = "Anonymous";
      delete obj.User;
      obj._namaPengirim = "Anonim";
    } else {
      obj._namaPengirim = sender?.Nama_Lengkap || obj.User_Pengirim || "Tidak diketahui";
      obj._emailPengirim = sender?.Email || "";
      obj._idCardPengirim = sender?.ID_Card_Unik || "";
      obj._jabatanPengirim = sender?.Jabatan_Divisi || "";
      obj._sppgPengirim = sender?.SPPG || obj.SPPG || "";
    }
    return obj;
  });

  return { success: true, pengaduan: sanitized };
}

async function tandaiSudahDibaca(data: { token?: string; idPengaduan?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak. Hanya Admin.");

  const { idPengaduan } = data;
  if (!idPengaduan) throw new ApiError("ID Pengaduan tidak boleh kosong.");

  const { data: target } = await supabase.from("Pengaduan").select("*").eq("ID_Pengaduan", idPengaduan).maybeSingle();
  if (!target) throw new ApiError(`Pengaduan dengan ID "${idPengaduan}" tidak ditemukan.`);
  if (!isSuperAdmin(session.role) && !(await getScopedUserIdSet(session)).has(target.User)) {
    throw new ApiError("Akses ditolak. Pengaduan berada di luar cakupan Anda.");
  }
  if (target.Status_Baca === "Sudah Dibaca") {
    return { success: true, message: "Pengaduan sudah ditandai dibaca sebelumnya." };
  }

  const { error } = await supabase
    .from("Pengaduan")
    .update({ Status_Baca: "Sudah Dibaca", Ditandai_Oleh: session.idUser, Waktu_Dibaca: new Date().toISOString() })
    .eq("ID_Pengaduan", idPengaduan);
  if (error) throw new Error("Gagal menandai pengaduan: " + error.message);

  await logAudit("TANDAI_PENGADUAN_DIBACA", { idPengaduan, adminUser: session.idUser }, session.idUser || null);
  return { success: true, message: "Pengaduan berhasil ditandai sudah dibaca." };
}

async function getRiwayatPengaduanSaya(data: { token?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user") throw new ApiError("Akses ditolak.");

  let idCardSaya = "";
  const { data: me } = await supabase.from("Users").select("ID_Card_Unik").eq("ID_User", session.idUser).maybeSingle();
  if (me) idCardSaya = String(me.ID_Card_Unik || "");

  const allPengaduan = await selectAllRows("Pengaduan");

  const milikSaya = allPengaduan
    .filter((r) => {
      if (r.User === session.idUser) return true;
      if (r.Jenis_Pengirim === "Anonymous") return false;
      if (idCardSaya && typeof r.User_Pengirim === "string" && r.User_Pengirim.indexOf(`(${idCardSaya})`) !== -1) return true;
      return false;
    })
    .sort((a, b) => new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime());

  return { success: true, pengaduan: milikSaya };
}

async function simpanTanggapanAdmin(data: { token?: string; idPengaduan?: string; tanggapan?: string }): Promise<unknown> {
  const session = await validateSession(data?.token || "");
  if (session.type !== "user" || !isAdminRole(session.role)) throw new ApiError("Akses ditolak. Hanya Admin.");

  const { idPengaduan, tanggapan } = data;
  if (!idPengaduan) throw new ApiError("ID Pengaduan tidak boleh kosong.");

  const { data: target } = await supabase.from("Pengaduan").select("*").eq("ID_Pengaduan", idPengaduan).maybeSingle();
  if (!target) throw new ApiError("Pengaduan tidak ditemukan.");
  if (!isSuperAdmin(session.role) && !(await getScopedUserIdSet(session)).has(target.User)) {
    throw new ApiError("Akses ditolak. Pengaduan berada di luar cakupan Anda.");
  }

  const tanggapanBersih = String(tanggapan || "").trim();
  if (!tanggapanBersih) throw new ApiError("Tanggapan tidak boleh kosong.");
  if (tanggapanBersih.length > 4000) throw new ApiError("Tanggapan maksimal 4.000 karakter.");

  const updatePayload: Record<string, any> = {
    Tanggapan_Admin: tanggapanBersih,
    Ditanggapi_Oleh: session.idUser,
    Waktu_Tanggapan: new Date().toISOString(),
  };
  let statusBerubah = false;
  if (target.Status_Baca !== "Sudah Dibaca") {
    updatePayload.Status_Baca = "Sudah Dibaca";
    updatePayload.Ditandai_Oleh = session.idUser;
    updatePayload.Waktu_Dibaca = new Date().toISOString();
    statusBerubah = true;
  }

  const { error } = await supabase.from("Pengaduan").update(updatePayload).eq("ID_Pengaduan", idPengaduan);
  if (error) throw new Error("Gagal menyimpan tanggapan: " + error.message);

  await logAudit("SIMPAN_TANGGAPAN_PENGADUAN", { idPengaduan, otomatisTandaiDibaca: statusBerubah }, session.idUser || null);
  return { success: true, otomatisTandaiDibaca: statusBerubah };
}

const API_FUNCTIONS: Record<string, (data: any) => Promise<unknown>> = {
  getPublicConfig: () => getPublicConfig(),
  login,
  logout,
  checkSession,
  getMasterData: () => getMasterData(),
  checkUsernameUnique,
  registerUser,
  verifyRegistrationOtp,
  requestResetPassword,
  requestResetPasswordByEmail,
  verifyResetPasswordOtp,
  resetPassword,
  resendConfirmationEmail,
  registerDevice,
  getAllDevices,
  toggleDeviceStatus,
  resetDevicePassword,
  getMyFaceProfile,
  lookupUserByIdCardSelf,
  verifyFaceLiveByIdUser,
  recordAbsensiSelf,
  lookupUserByIdCard,
  recordAbsensi,
  getAbsensiData,
  getAbsensiGroupedData,
  getMyAbsensi,
  getDataKaryawan,
  getKaryawanForPayroll,
  prosesPayroll,
  getMyPayroll,
  getSlipDownloadUrl,
  getAbsensiForPayrollPreview,
  getAllPayrollHistory,
  getAllSlipGajiList,
  getAllMasterSppgList,
  getAksesEmailList,
  saveAksesEmail,
  deleteAksesEmail,
  getAllMasterJabatanList,
  updateData,
  deleteData,
  deleteMultipleData,
  getAuditLog,
  getAuditLogEnriched,
  getProfilLengkap,
  updateProfil,
  changePassword,
  updateFaceDescriptor,
  updateFotoProfil,
  getAllUsers,
  toggleUserStatus,
  getDashboardData,
  kirimPengaduan,
  getNotifikasiAdmin,
  getDaftarPengaduan,
  tandaiSudahDibaca,
  getRiwayatPengaduanSaya,
  simpanTanggapanAdmin,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return errResult("Method tidak didukung. Gunakan POST.", 405);
  }

  let body: { function?: string; data?: unknown };
  try {
    body = await req.json();
  } catch {
    return errResult("Body request harus berupa JSON valid.");
  }

  const functionName = body.function;
  const data = body.data || {};

  if (!functionName) {
    return errResult("Nama fungsi tidak dikirim (field: function).");
  }

  const fn = API_FUNCTIONS[functionName];
  if (!fn) {
    return errResult("Fungsi tidak dikenali: " + functionName);
  }

  try {
    const result = await fn(data);
    return okResult(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error saat menjalankan '${functionName}':`, err);
    return errResult(message);
  }
});
