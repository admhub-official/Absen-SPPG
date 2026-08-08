import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

type JsonRecord = Record<string, any>;

interface PayrollSession {
  idUser: string;
  role: string;
}

interface PayrollInput {
  idUser: string;
  bonus?: number;
  potongan?: number;
  keteranganPotongan?: string;
}

interface PayrollCalculation {
  user: JsonRecord;
  attendanceIds: string[];
  jumlahHariKerja: number;
  gajiHarian: number;
  subtotalGaji: number;
  bonus: number;
  potongan: number;
  keteranganPotongan: string;
  totalGaji: number;
}

const HANDLED_FUNCTIONS = new Set([
  "prosesPayroll",
  "getMyPayroll",
  "getSlipDownloadUrl",
  "signPayrollReceipt",
]);
const STORAGE_CACHE_TTL_MS = 15 * 60 * 1000;
const STORAGE_CACHE_MAX_ENTRIES = 32;
const storageDownloadCache = new Map<string, { bytes: Uint8Array; expiresAt: number }>();

function normalizeRole(value: unknown): string {
  return String(value || "").trim().toUpperCase().replace(/_/g, " ");
}

function isActive(value: unknown): boolean {
  return value === true || value === 1 || ["TRUE", "1"].includes(String(value || "").toUpperCase());
}

function isAdminRole(value: unknown): boolean {
  return ["ADMIN", "SUPER ADMIN"].includes(normalizeRole(value));
}

function isSuperAdmin(value: unknown): boolean {
  return normalizeRole(value) === "SUPER ADMIN";
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function toDateString(value: unknown): string {
  return String(value || "").split("T")[0].split(" ")[0];
}

function parsePayrollDate(value: unknown, label: string): string {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${label} tidak valid`);
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${label} tidak valid`);
  }
  return normalized;
}

function parseMoney(value: unknown, label: string): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) {
    throw new Error(`${label} harus berupa nominal valid antara 0 dan 1 miliar`);
  }
  return Math.round(amount);
}

function decodePngDataUrl(value: unknown, label: string, maxBytes = 1_500_000): Uint8Array {
  const dataUrl = String(value || "");
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error(`${label} wajib tersedia dalam format PNG`);
  const base64 = match[1].replace(/\s/g, "");
  if (base64.length > Math.ceil(maxBytes * 4 / 3) + 16) throw new Error(`${label} terlalu besar`);
  try {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    if (bytes.length < 100 || bytes.length > maxBytes) throw new Error("invalid size");
    const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!pngHeader.every((byte, index) => bytes[index] === byte)) throw new Error("invalid header");
    return bytes;
  } catch {
    throw new Error(`${label} tidak valid`);
  }
}

function safePath(value: unknown): string {
  return String(value || "data")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "data";
}

function safeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}

function formatDate(value: unknown): string {
  const date = new Date(`${toDateString(value)}T00:00:00+07:00`);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: Date): string {
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

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isCountedWorkDay(rows: JsonRecord[]): boolean {
  return rows.some((row) => row.Jenis_Absen === "PUNCH_TUNGGAL") ||
    (rows.some((row) => row.Jenis_Absen === "DATANG") &&
      rows.some((row) => row.Jenis_Absen === "PULANG"));
}

async function validateSession(supabase: SupabaseClient, token: unknown): Promise<PayrollSession> {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) throw new Error("SESI_HABIS");
  const { data: session, error: sessionError } = await supabase
    .from("Sessions")
    .select("Type, ID_User, Role, Expires_At")
    .eq("Token", cleanToken)
    .maybeSingle();
  if (sessionError || !session || new Date(session.Expires_At).getTime() < Date.now()) {
    throw new Error("SESI_HABIS");
  }
  if (String(session.Type || "").toLowerCase() !== "user" || !session.ID_User) {
    throw new Error("Akses ditolak");
  }
  const { data: user, error: userError } = await supabase
    .from("Users")
    .select("ID_User, Role, Status_Aktif")
    .eq("ID_User", session.ID_User)
    .maybeSingle();
  if (userError || !user || !isActive(user.Status_Aktif)) throw new Error("AKUN_NONAKTIF");
  return { idUser: String(user.ID_User), role: normalizeRole(user.Role || session.Role) };
}

async function getScopedUserIds(
  supabase: SupabaseClient,
  session: PayrollSession,
  targetIds: string[],
): Promise<Set<string>> {
  const uniqueTargetIds = [...new Set(targetIds.map(String).filter(Boolean))];
  if (!uniqueTargetIds.length) return new Set();
  if (isSuperAdmin(session.role)) {
    return new Set(uniqueTargetIds);
  }

  const { data: actor, error: actorError } = await supabase
    .from("Users")
    .select("Email")
    .eq("ID_User", session.idUser)
    .maybeSingle();
  if (actorError) throw new Error("Gagal membaca profil penerbit: " + actorError.message);
  if (!actor?.Email) return new Set([session.idUser]);

  const { data: accessRows, error: accessError } = await supabase
    .from("Akses_Email")
    .select("SPPG, Aktif")
    .ilike("Email", actor.Email);
  if (accessError) throw new Error("Gagal membaca cakupan SPPG: " + accessError.message);
  const sppgList = (accessRows || [])
    .filter((row: JsonRecord) => isActive(row.Aktif))
    .map((row: JsonRecord) => String(row.SPPG || "").trim())
    .filter(Boolean);
  if (!sppgList.length) return new Set([session.idUser]);

  const { data: users, error: usersError } = await supabase
    .from("Users")
    .select("ID_User, Role")
    .in("SPPG", sppgList)
    .in("ID_User", uniqueTargetIds);
  if (usersError) throw new Error("Gagal membaca pengguna SPPG: " + usersError.message);
  return new Set((users || [])
    .filter((row: JsonRecord) => !isSuperAdmin(row.Role))
    .map((row: JsonRecord) => String(row.ID_User)));
}

async function selectAll(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  filter: (query: any) => any,
): Promise<JsonRecord[]> {
  const pageSize = 1000;
  const first = await filter(supabase.from(table).select(columns, { count: "exact" })).range(0, pageSize - 1);
  if (first.error) throw new Error(`Gagal membaca ${table}: ${first.error.message}`);
  const rows = [...(first.data || [])];
  const total = first.count ?? rows.length;
  for (let from = pageSize; from < total; from += pageSize) {
    const page = await filter(supabase.from(table).select(columns))
      .range(from, Math.min(from + pageSize - 1, total - 1));
    if (page.error) throw new Error(`Gagal membaca ${table}: ${page.error.message}`);
    rows.push(...(page.data || []));
  }
  return rows;
}

async function downloadStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  label: string,
): Promise<Uint8Array> {
  const cacheKey = `${bucket}:${path}`;
  const cached = storageDownloadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.bytes.slice();
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`${label} tidak dapat dibaca`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (storageDownloadCache.size >= STORAGE_CACHE_MAX_ENTRIES) {
    const oldestKey = storageDownloadCache.keys().next().value;
    if (oldestKey) storageDownloadCache.delete(oldestKey);
  }
  storageDownloadCache.set(cacheKey, { bytes, expiresAt: Date.now() + STORAGE_CACHE_TTL_MS });
  return bytes.slice();
}

async function logAudit(
  supabase: SupabaseClient,
  activity: string,
  detail: JsonRecord,
  idUser: string,
): Promise<void> {
  try {
    const result = await supabase.from("Audit_Log").insert({
      ID_Log: generateId("LOG"),
      Waktu: new Date().toISOString(),
      ID_User_Pelaku: idUser,
      Jenis_Aktivitas: activity,
      Detail: detail,
      IP_Address: "N/A",
    });
    if (result.error) throw result.error;
  } catch (error) {
    console.error("Payroll signature audit failed", error);
  }
}

async function cleanupStorageBestEffort(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
  phase: string,
): Promise<void> {
  if (!paths.length) return;
  const result = await supabase.storage.from(bucket).remove(paths);
  if (result.error) {
    console.error(JSON.stringify({ code: "PAYROLL_STORAGE_CLEANUP_DEFERRED", phase, bucket, error: result.error.message }));
  }
}

async function cleanupRowsBestEffort(
  promise: PromiseLike<{ error: { message?: string } | null }>,
  phase: string,
): Promise<void> {
  try {
    const result = await promise;
    if (result.error) {
      console.error(JSON.stringify({ code: "PAYROLL_DB_CLEANUP_DEFERRED", phase, error: result.error.message || "unknown" }));
    }
  } catch (error) {
    console.error(JSON.stringify({ code: "PAYROLL_DB_CLEANUP_DEFERRED", phase, error: error instanceof Error ? error.message : String(error) }));
  }
}

export async function buildFinalSlipPdf(input: {
  slip: JsonRecord;
  payroll: JsonRecord;
  user: JsonRecord;
  logoBytes: Uint8Array;
  accountantSignatureBytes: Uint8Array;
  headSignatureBytes: Uint8Array;
  recipientSignatureBytes: Uint8Array;
  signedAt: Date;
}): Promise<Uint8Array> {
  const {
    slip,
    payroll,
    user,
    logoBytes,
    accountantSignatureBytes,
    headSignatureBytes,
    recipientSignatureBytes,
    signedAt,
  } = input;
  const pdf = await PDFDocument.create();
  pdf.setTitle(safeText(`Slip Gaji ${user.Nama_Lengkap || user.ID_User}`));
  pdf.setAuthor(safeText(`SPPG ${user.SPPG || ""}`));
  pdf.setSubject(`Slip gaji periode ${toDateString(slip.Periode_Mulai)} - ${toDateString(slip.Periode_Akhir)}`);
  pdf.setCreator("Sistem Absensi dan Payroll SPPG");
  pdf.setCreationDate(signedAt);
  pdf.setModificationDate(signedAt);

  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(logoBytes);
  const accountantSignature = await pdf.embedPng(accountantSignatureBytes);
  const headSignature = await pdf.embedPng(headSignatureBytes);
  const recipientSignature = await pdf.embedPng(recipientSignatureBytes);
  const navy = rgb(0.06, 0.12, 0.24);
  const blue = rgb(0.22, 0.27, 0.75);
  const muted = rgb(0.35, 0.4, 0.48);
  const border = rgb(0.87, 0.89, 0.93);
  const pale = rgb(0.96, 0.97, 0.99);
  const green = rgb(0.05, 0.45, 0.28);
  const left = 42;
  const right = 553;
  const contentWidth = right - left;

  page.drawRectangle({ x: 0, y: 748, width: 595.28, height: 93.89, color: rgb(1, 1, 1) });
  const logoWidth = 66;
  const logoHeight = Math.min(68, logoWidth * (logo.height / logo.width));
  page.drawImage(logo, { x: left, y: 765, width: logoWidth, height: logoHeight });
  page.drawRectangle({ x: left + 82, y: 770, width: 5, height: 48, color: blue });
  page.drawText("SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)", {
    x: left + 100, y: 805, size: 11, font: bold, color: navy,
  });
  page.drawText(safeText(user.SPPG || "NAMA SPPG BELUM DIATUR").toUpperCase(), {
    x: left + 100, y: 781, size: 17, font: bold, color: navy,
  });
  page.drawLine({ start: { x: left, y: 755 }, end: { x: right, y: 755 }, thickness: 1.2, color: navy });

  page.drawText("SLIP GAJI", { x: left, y: 721, size: 20, font: bold, color: navy });
  page.drawText(`No. ${safeText(slip.ID_Slip)}`, { x: left, y: 704, size: 8.5, font: regular, color: muted });
  page.drawText(`Batch ${safeText(slip.ID_Payroll)}`, { x: right - 190, y: 721, size: 8.5, font: regular, color: muted });
  page.drawText(`Final: ${formatDateTime(signedAt)}`, {
    x: right - 190, y: 704, size: 8.5, font: regular, color: muted,
  });

  page.drawRectangle({ x: left, y: 614, width: contentWidth, height: 70, color: pale, borderColor: border, borderWidth: 1 });
  const identityRows = [
    ["Nama", safeText(user.Nama_Lengkap || "-")],
    ["Jabatan / Divisi", safeText(user.Jabatan_Divisi || "-")],
    ["Periode", `${formatDate(slip.Periode_Mulai)} s.d. ${formatDate(slip.Periode_Akhir)}`],
  ];
  identityRows.forEach(([label, value], index) => {
    const y = 662 - index * 20;
    page.drawText(label, { x: left + 14, y, size: 9, font: bold, color: muted });
    page.drawText(":", { x: left + 112, y, size: 9, font: regular, color: muted });
    page.drawText(value.slice(0, 74), { x: left + 126, y, size: 10, font: regular, color: navy });
  });

  page.drawText("RINCIAN PENGHASILAN", { x: left, y: 581, size: 10, font: bold, color: navy });
  page.drawRectangle({ x: left, y: 544, width: contentWidth, height: 27, color: navy });
  page.drawText("KOMPONEN", { x: left + 14, y: 554, size: 9, font: bold, color: rgb(1, 1, 1) });
  page.drawText("PERHITUNGAN", { x: left + 248, y: 554, size: 9, font: bold, color: rgb(1, 1, 1) });
  page.drawText("NOMINAL", { x: right - 76, y: 554, size: 9, font: bold, color: rgb(1, 1, 1) });

  const components: Array<[string, string, number]> = [
    ["Gaji pokok", `${formatRupiah(Number(slip.Gaji_Harian))} x ${Number(slip.Jumlah_Hari_Kerja)} hari`, Number(slip.Subtotal_Gaji)],
    ["Bonus / Tambahan", "Penyesuaian manual", Number(slip.Bonus || 0)],
    ["Potongan", String(slip.Keterangan_Potongan || "Tidak ada keterangan"), -Number(slip.Potongan || 0)],
  ];
  let rowY = 512;
  components.forEach(([label, detail, amount], index) => {
    if (index % 2 === 1) page.drawRectangle({ x: left, y: rowY - 12, width: contentWidth, height: 36, color: pale });
    page.drawText(label, { x: left + 14, y: rowY, size: 10, font: bold, color: navy });
    page.drawText(safeText(detail).slice(0, 40), { x: left + 248, y: rowY, size: 9, font: regular, color: muted });
    const nominal = amount < 0 ? `- ${formatRupiah(Math.abs(amount))}` : formatRupiah(amount);
    page.drawText(nominal, {
      x: right - 14 - regular.widthOfTextAtSize(nominal, 9),
      y: rowY,
      size: 9,
      font: regular,
      color: amount < 0 ? rgb(0.72, 0.12, 0.12) : navy,
    });
    page.drawLine({ start: { x: left, y: rowY - 13 }, end: { x: right, y: rowY - 13 }, thickness: 0.7, color: border });
    rowY -= 36;
  });

  page.drawRectangle({ x: left, y: 374, width: contentWidth, height: 54, color: rgb(0.92, 0.98, 0.95), borderColor: rgb(0.65, 0.89, 0.76), borderWidth: 1 });
  page.drawText("TOTAL GAJI DITERIMA", { x: left + 16, y: 395, size: 11, font: bold, color: green });
  const totalText = formatRupiah(Number(slip.Total_Gaji_Diterima));
  page.drawText(totalText, {
    x: right - 16 - bold.widthOfTextAtSize(totalText, 16), y: 391, size: 16, font: bold, color: green,
  });

  page.drawText("Dokumen final setelah ditandatangani penerima melalui akun terkait.", {
    x: left, y: 347, size: 8, font: regular, color: muted,
  });
  page.drawText(`Tanggal tanda tangan penerima: ${formatDateTime(signedAt)}`, {
    x: left, y: 333, size: 8, font: regular, color: muted,
  });

  const signers = [
    {
      heading: "Mengetahui,",
      name: String(payroll.Nama_Akuntan || "Akuntan"),
      role: "AKUNTAN",
      image: accountantSignature,
    },
    {
      heading: "Menyetujui,",
      name: String(payroll.Nama_Kepala_SPPG || "Kepala SPPG"),
      role: "KEPALA SPPG",
      image: headSignature,
    },
    {
      heading: "Penerima,",
      name: String(user.Nama_Lengkap || user.ID_User),
      role: "PENERIMA",
      image: recipientSignature,
    },
  ];
  const columnGap = 12;
  const columnWidth = (contentWidth - columnGap * 2) / 3;
  signers.forEach((signer, index) => {
    const x = left + index * (columnWidth + columnGap);
    const imageWidth = Math.min(112, columnWidth - 14);
    const imageHeight = Math.min(62, imageWidth * (signer.image.height / signer.image.width));
    page.drawText(signer.heading, { x, y: 302, size: 8.5, font: regular, color: navy });
    page.drawImage(signer.image, {
      x: x + (columnWidth - imageWidth) / 2,
      y: 223,
      width: imageWidth,
      height: imageHeight,
    });
    page.drawLine({ start: { x, y: 211 }, end: { x: x + columnWidth, y: 211 }, thickness: 0.8, color: muted });
    const name = safeText(signer.name).slice(0, 28);
    const nameWidth = bold.widthOfTextAtSize(name, 8.5);
    page.drawText(name, {
      x: x + Math.max(0, (columnWidth - nameWidth) / 2), y: 195, size: 8.5, font: bold, color: navy,
    });
    const roleWidth = regular.widthOfTextAtSize(signer.role, 7.5);
    page.drawText(signer.role, {
      x: x + Math.max(0, (columnWidth - roleWidth) / 2), y: 181, size: 7.5, font: regular, color: muted,
    });
  });

  page.drawLine({ start: { x: left, y: 90 }, end: { x: right, y: 90 }, thickness: 0.7, color: border });
  page.drawText("Slip bersifat rahasia. Pastikan data dan nominal telah sesuai sebelum digunakan.", {
    x: left, y: 72, size: 8, font: regular, color: muted,
  });
  page.drawText("1 / 1", { x: right - 20, y: 72, size: 8, font: regular, color: muted });
  return await pdf.save({ useObjectStreams: false });
}

async function processPayroll(
  supabase: SupabaseClient,
  data: JsonRecord,
): Promise<JsonRecord> {
  const session = await validateSession(supabase, data.token);
  if (!isAdminRole(session.role)) {
    throw new Error("Akses ditolak. Hanya Admin atau Super Admin yang dapat menerbitkan slip.");
  }

  const employees = Array.isArray(data.karyawanData) ? data.karyawanData as PayrollInput[] : [];
  if (!employees.length) throw new Error("Data payroll tidak lengkap");
  if (employees.length > 50) throw new Error("Maksimal 50 slip dapat diterbitkan dalam satu batch");
  const periodStart = parsePayrollDate(data.periodeMulai, "Tanggal mulai periode");
  const periodEnd = parsePayrollDate(data.periodeAkhir, "Tanggal akhir periode");
  const startMs = Date.parse(`${periodStart}T00:00:00Z`);
  const endMs = Date.parse(`${periodEnd}T00:00:00Z`);
  if (endMs < startMs) throw new Error("Tanggal akhir periode tidak boleh sebelum tanggal mulai");
  if ((endMs - startMs) / 86_400_000 > 366) throw new Error("Periode payroll maksimal 366 hari");

  const accountantName = String(data.namaAkuntan || "").trim().slice(0, 120);
  const headName = String(data.namaKepalaSppg || "").trim().slice(0, 120);
  if (!accountantName) throw new Error("Nama Akuntan wajib diisi");
  if (!headName) throw new Error("Nama Kepala SPPG wajib diisi");
  const accountantSignatureBytes = decodePngDataUrl(data.tandaTanganAkuntanBase64, "Tanda tangan Akuntan");
  const headSignatureBytes = decodePngDataUrl(data.tandaTanganKepalaSppgBase64, "Tanda tangan Kepala SPPG");
  const logoBytes = decodePngDataUrl(data.logoBgnBase64, "Logo BGN", 3_000_000);

  const uniqueIds = [...new Set(employees.map((row) => String(row.idUser || "").trim()).filter(Boolean))];
  if (uniqueIds.length !== employees.length) throw new Error("Daftar karyawan berisi ID kosong atau duplikat");
  const scopedIds = await getScopedUserIds(supabase, session, uniqueIds);
  if (uniqueIds.some((id) => !scopedIds.has(id))) {
    throw new Error("Akses ditolak: terdapat karyawan di luar cakupan SPPG Anda");
  }

  const { data: users, error: usersError } = await supabase
    .from("Users")
    .select("ID_User, Nama_Lengkap, Jabatan_Divisi, Gaji_Harian, SPPG, Yayasan, Role, Status_Aktif")
    .in("ID_User", uniqueIds);
  if (usersError) throw new Error("Gagal mengambil data karyawan: " + usersError.message);
  if ((users || []).length !== uniqueIds.length) throw new Error("Sebagian data karyawan tidak ditemukan");
  const userMap = new Map<string, JsonRecord>(
    (users || []).map((user: JsonRecord) => [String(user.ID_User), user]),
  );
  uniqueIds.forEach((id) => {
    const user = userMap.get(id);
    if (!user || normalizeRole(user.Role) !== "USER" || !isActive(user.Status_Aktif)) {
      throw new Error("Slip hanya dapat diterbitkan untuk karyawan aktif");
    }
    if (parseMoney(user.Gaji_Harian, "Gaji harian") <= 0) {
      throw new Error(`Gaji harian ${user.Nama_Lengkap || id} belum diatur`);
    }
  });

  const { data: duplicates, error: duplicateError } = await supabase
    .from("Slip_Gaji")
    .select("ID_User")
    .in("ID_User", uniqueIds)
    .eq("Periode_Mulai", periodStart)
    .eq("Periode_Akhir", periodEnd)
    .in("Status_Penerbitan", ["MENUNGGU_TTD_PENERIMA", "DITERBITKAN"]);
  if (duplicateError) throw new Error("Gagal memeriksa slip lama: " + duplicateError.message);
  if ((duplicates || []).length) {
    const names = (duplicates || []).map((row: JsonRecord) => userMap.get(String(row.ID_User))?.Nama_Lengkap || row.ID_User);
    throw new Error(`Slip periode yang sama sudah tersedia untuk: ${names.join(", ")}`);
  }

  const attendance = await selectAll(
    supabase,
    "Absensi",
    "ID_Absen, ID_User, Tanggal, Jenis_Absen, Status_Validasi, ID_Payroll",
    (query) => query
      .in("ID_User", uniqueIds)
      .eq("Status_Validasi", "VALID")
      .gte("Tanggal", periodStart)
      .lte("Tanggal", periodEnd),
  );
  const inputMap = new Map(employees.map((row) => [String(row.idUser), row]));
  const calculations: PayrollCalculation[] = uniqueIds.map((id) => {
    const user = userMap.get(id)!;
    const employeeInput = inputMap.get(id)!;
    const availableAttendance = attendance.filter((row) => row.ID_User === id && !row.ID_Payroll);
    const byDate = new Map<string, JsonRecord[]>();
    availableAttendance.forEach((row) => {
      const date = toDateString(row.Tanggal);
      byDate.set(date, [...(byDate.get(date) || []), row]);
    });
    const workDates = [...byDate.entries()].filter(([, rows]) => isCountedWorkDay(rows)).map(([date]) => date);
    const counted = new Set(workDates);
    const attendanceIds = availableAttendance
      .filter((row) => counted.has(toDateString(row.Tanggal)))
      .map((row) => String(row.ID_Absen));
    const dailySalary = parseMoney(user.Gaji_Harian, "Gaji harian");
    const bonus = parseMoney(employeeInput.bonus, "Bonus / tambahan");
    const deduction = parseMoney(employeeInput.potongan, "Potongan");
    const subtotal = dailySalary * workDates.length;
    const total = subtotal + bonus - deduction;
    if (total < 0) throw new Error(`Total gaji ${user.Nama_Lengkap || id} tidak boleh negatif`);
    return {
      user,
      attendanceIds,
      jumlahHariKerja: workDates.length,
      gajiHarian: dailySalary,
      subtotalGaji: subtotal,
      bonus,
      potongan: deduction,
      keteranganPotongan: String(employeeInput.keteranganPotongan || "").trim().slice(0, 300),
      totalGaji: total,
    };
  });

  const { data: issuer, error: issuerError } = await supabase
    .from("Users")
    .select("Nama_Lengkap")
    .eq("ID_User", session.idUser)
    .maybeSingle();
  if (issuerError) throw new Error("Gagal mengambil data penerbit: " + issuerError.message);
  const issuerName = String(issuer?.Nama_Lengkap || "").trim();
  if (!issuerName) throw new Error("Nama lengkap Admin wajib diisi sebelum menerbitkan slip");

  const sppgList = [...new Set(calculations.map((item) => String(item.user.SPPG || "").trim()).filter(Boolean))];
  if (sppgList.length !== 1) {
    throw new Error("Satu batch slip bertanda tangan hanya boleh berisi karyawan dari satu SPPG");
  }
  const foundationList = [...new Set(calculations.map((item) => item.user.Yayasan).filter(Boolean))];
  const idPayroll = generateId("PAY");
  const issuedAt = new Date();
  const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Jakarta", year: "numeric" }).format(issuedAt);
  const basePath = `${year}/${idPayroll}`;
  const accountantPath = `${basePath}/ttd-akuntan.png`;
  const headPath = `${basePath}/ttd-kepala-sppg.png`;
  const logoPath = `${basePath}/logo-bgn.png`;
  const uploadedPaths: string[] = [];
  let payrollInserted = false;

  try {
    for (const asset of [
      { path: accountantPath, bytes: accountantSignatureBytes, label: "tanda tangan Akuntan" },
      { path: headPath, bytes: headSignatureBytes, label: "tanda tangan Kepala SPPG" },
      { path: logoPath, bytes: logoBytes, label: "logo BGN" },
    ]) {
      const { error } = await supabase.storage
        .from("tanda-tangan")
        .upload(asset.path, asset.bytes, {
          contentType: "image/png",
          cacheControl: "31536000",
          upsert: false,
        });
      if (error) throw new Error(`Gagal menyimpan ${asset.label}: ${error.message}`);
      uploadedPaths.push(asset.path);
    }

    const { error: payrollError } = await supabase.from("Payroll").insert({
      ID_Payroll: idPayroll,
      Periode_Mulai: periodStart,
      Periode_Akhir: periodEnd,
      Diproses_Oleh: session.idUser,
      Tanda_Tangan_Digital_URL: accountantPath,
      Waktu_Proses: issuedAt.toISOString(),
      Jumlah_Karyawan: calculations.length,
      SPPG: sppgList.length === 1 ? sppgList[0] : "MULTI SPPG",
      Yayasan: foundationList.length === 1 ? foundationList[0] : "MULTI YAYASAN",
      Status_Penerbitan: "MENUNGGU_TTD_PENERIMA",
      Diterbitkan_At: issuedAt.toISOString(),
      Diterbitkan_Oleh: session.idUser,
      Nama_Penerbit: issuerName,
      Nama_Akuntan: accountantName,
      TTD_Akuntan_Path: accountantPath,
      Nama_Kepala_SPPG: headName,
      TTD_Kepala_SPPG_Path: headPath,
      Logo_BGN_Path: logoPath,
    });
    if (payrollError) throw new Error("Gagal menyimpan batch payroll: " + payrollError.message);
    payrollInserted = true;

    const slips = calculations.map((calculation) => ({
      ID_Slip: generateId("SLIP"),
      ID_Payroll: idPayroll,
      ID_User: calculation.user.ID_User,
      Periode_Mulai: periodStart,
      Periode_Akhir: periodEnd,
      Jumlah_Hari_Kerja: calculation.jumlahHariKerja,
      Gaji_Harian: calculation.gajiHarian,
      Subtotal_Gaji: calculation.subtotalGaji,
      Lembur_Nominal: 0,
      Bonus: calculation.bonus,
      Potongan: calculation.potongan,
      Keterangan_Potongan: calculation.keteranganPotongan,
      Total_Gaji_Diterima: calculation.totalGaji,
      URL_PDF_Slip: "",
      PDF_Storage_Path: null,
      PDF_SHA256: null,
      SPPG: calculation.user.SPPG,
      Yayasan: calculation.user.Yayasan,
      Status_Penerbitan: "MENUNGGU_TTD_PENERIMA",
      Diterbitkan_At: issuedAt.toISOString(),
      Diterbitkan_Oleh: session.idUser,
      Nama_Penerbit: issuerName,
      Dicetak_At: null,
      TTD_Penerima_Path: null,
      Ditandatangani_Penerima_At: null,
    }));
    const { error: slipError } = await supabase.from("Slip_Gaji").insert(slips);
    if (slipError) throw new Error("Gagal menyimpan slip gaji: " + slipError.message);

    const attendanceIds = calculations.flatMap((item) => item.attendanceIds);
    if (attendanceIds.length) {
      const { error: attendanceError } = await supabase
        .from("Absensi")
        .update({ ID_Payroll: idPayroll })
        .in("ID_Absen", attendanceIds);
      if (attendanceError) throw new Error("Gagal menandai absensi payroll: " + attendanceError.message);
    }

    await logAudit(supabase, "TERBITKAN_SLIP_MENUNGGU_TTD_PENERIMA", {
      idPayroll,
      periodStart,
      periodEnd,
      jumlahKaryawan: calculations.length,
      namaAkuntan: accountantName,
      namaKepalaSppg: headName,
    }, session.idUser);

    return {
      success: true,
      idPayroll,
      jumlahSlip: slips.length,
      slip: slips.map((slip, index) => ({
        idSlip: slip.ID_Slip,
        idUser: slip.ID_User,
        namaLengkap: calculations[index].user.Nama_Lengkap,
        totalGaji: slip.Total_Gaji_Diterima,
        status: slip.Status_Penerbitan,
      })),
      message: `${slips.length} slip dikirim ke akun karyawan untuk tanda tangan penerima`,
    };
  } catch (error) {
    if (payrollInserted) {
      await cleanupRowsBestEffort(
        supabase.from("Slip_Gaji").delete().eq("ID_Payroll", idPayroll),
        "DELETE_SLIPS_AFTER_FAILURE",
      );
      await cleanupRowsBestEffort(
        supabase.from("Payroll").delete().eq("ID_Payroll", idPayroll),
        "DELETE_PAYROLL_AFTER_FAILURE",
      );
    }
    await cleanupStorageBestEffort(supabase, "tanda-tangan", uploadedPaths, "REMOVE_BATCH_ASSETS_AFTER_FAILURE");
    throw error;
  }
}

async function getMyPayroll(supabase: SupabaseClient, data: JsonRecord): Promise<JsonRecord> {
  const session = await validateSession(supabase, data.token);
  const { data: slips, error: slipsError } = await supabase
    .from("Slip_Gaji")
    .select("ID_Slip,ID_Payroll,ID_User,Periode_Mulai,Periode_Akhir,Jumlah_Hari_Kerja,Gaji_Harian,Subtotal_Gaji,Lembur_Nominal,Bonus,Potongan,Keterangan_Potongan,Total_Gaji_Diterima,Status_Penerbitan,Diterbitkan_At,Nama_Penerbit,Ditandatangani_Penerima_At,PDF_Storage_Path,URL_PDF_Slip")
    .eq("ID_User", session.idUser)
    .in("Status_Penerbitan", ["MENUNGGU_TTD_PENERIMA", "DITERBITKAN"])
    .order("Diterbitkan_At", { ascending: false })
    .limit(50);
  if (slipsError) throw new Error("Gagal mengambil slip gaji: " + slipsError.message);
  const { data: user, error: userError } = await supabase
    .from("Users")
    .select("Nama_Lengkap, Jabatan_Divisi, SPPG")
    .eq("ID_User", session.idUser)
    .maybeSingle();
  if (userError) throw new Error("Gagal mengambil profil: " + userError.message);
  return {
    success: true,
    namaLengkap: user?.Nama_Lengkap || "",
    jabatanDivisi: user?.Jabatan_Divisi || "",
    sppg: user?.SPPG || "",
    payroll: (slips || []).map((slip: JsonRecord) => ({
      idSlip: slip.ID_Slip,
      idPayroll: slip.ID_Payroll,
      periodeMulai: slip.Periode_Mulai,
      periodeAkhir: slip.Periode_Akhir,
      jumlahHariKerja: slip.Jumlah_Hari_Kerja,
      gajiHarian: slip.Gaji_Harian,
      subtotalGaji: slip.Subtotal_Gaji,
      lembur: slip.Lembur_Nominal,
      bonus: slip.Bonus,
      potongan: slip.Potongan,
      keteranganPotongan: slip.Keterangan_Potongan,
      totalGaji: slip.Total_Gaji_Diterima,
      statusPenerbitan: slip.Status_Penerbitan,
      diterbitkanAt: slip.Diterbitkan_At,
      namaPenerbit: slip.Nama_Penerbit,
      ditandatanganiPenerimaAt: slip.Ditandatangani_Penerima_At,
      perluTandaTangan: slip.Status_Penerbitan === "MENUNGGU_TTD_PENERIMA",
      dapatDiunduh: slip.Status_Penerbitan === "DITERBITKAN" && Boolean(slip.PDF_Storage_Path || slip.URL_PDF_Slip),
    })),
  };
}

async function signPayrollReceipt(supabase: SupabaseClient, data: JsonRecord): Promise<JsonRecord> {
  const session = await validateSession(supabase, data.token);
  const idSlip = String(data.idSlip || "").trim();
  if (!idSlip) throw new Error("ID slip tidak ditemukan");
  const recipientSignatureBytes = decodePngDataUrl(data.tandaTanganPenerimaBase64, "Tanda tangan penerima");

  const { data: slip, error: slipError } = await supabase
    .from("Slip_Gaji")
    .select("ID_Slip,ID_Payroll,ID_User,Periode_Mulai,Periode_Akhir,Jumlah_Hari_Kerja,Gaji_Harian,Subtotal_Gaji,Bonus,Potongan,Keterangan_Potongan,Total_Gaji_Diterima,Status_Penerbitan")
    .eq("ID_Slip", idSlip)
    .maybeSingle();
  if (slipError) throw new Error("Gagal membaca slip: " + slipError.message);
  if (!slip || String(slip.ID_User) !== session.idUser) throw new Error("Slip tidak ditemukan pada akun Anda");
  if (slip.Status_Penerbitan === "DITERBITKAN") {
    throw new Error("Slip ini sudah ditandatangani");
  }
  if (slip.Status_Penerbitan !== "MENUNGGU_TTD_PENERIMA") {
    throw new Error("Slip belum dapat ditandatangani");
  }

  const [{ data: payroll, error: payrollError }, { data: user, error: userError }] = await Promise.all([
    supabase.from("Payroll")
      .select("ID_Payroll,Nama_Akuntan,Nama_Kepala_SPPG,TTD_Akuntan_Path,TTD_Kepala_SPPG_Path,Logo_BGN_Path")
      .eq("ID_Payroll", slip.ID_Payroll)
      .maybeSingle(),
    supabase.from("Users")
      .select("ID_User, Nama_Lengkap, Jabatan_Divisi, SPPG")
      .eq("ID_User", session.idUser)
      .maybeSingle(),
  ]);
  if (payrollError || !payroll) throw new Error("Data batch payroll tidak ditemukan");
  if (userError || !user) throw new Error("Data penerima tidak ditemukan");
  if (!payroll.TTD_Akuntan_Path || !payroll.TTD_Kepala_SPPG_Path || !payroll.Logo_BGN_Path) {
    throw new Error("Logo atau tanda tangan pejabat pada batch belum lengkap");
  }

  const [logoBytes, accountantBytes, headBytes] = await Promise.all([
    downloadStorageObject(supabase, "tanda-tangan", payroll.Logo_BGN_Path, "Logo BGN"),
    downloadStorageObject(supabase, "tanda-tangan", payroll.TTD_Akuntan_Path, "Tanda tangan Akuntan"),
    downloadStorageObject(supabase, "tanda-tangan", payroll.TTD_Kepala_SPPG_Path, "Tanda tangan Kepala SPPG"),
  ]);
  const signedAt = new Date();
  const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Jakarta", year: "numeric" }).format(signedAt);
  const recipientPath = `${year}/${slip.ID_Payroll}/${safePath(user.Nama_Lengkap)}-${idSlip}-penerima.png`;
  const pdfPath = `${year}/${slip.ID_Payroll}/${safePath(user.Nama_Lengkap)}-${idSlip}.pdf`;
  let recipientUploaded = false;
  let pdfUploaded = false;
  let finalized = false;

  try {
    const { error: signatureUploadError } = await supabase.storage
      .from("tanda-tangan")
      .upload(recipientPath, recipientSignatureBytes, {
        contentType: "image/png",
        cacheControl: "31536000",
        upsert: false,
      });
    if (signatureUploadError) throw new Error("Gagal menyimpan tanda tangan penerima: " + signatureUploadError.message);
    recipientUploaded = true;

    const pdfBytes = await buildFinalSlipPdf({
      slip,
      payroll,
      user,
      logoBytes,
      accountantSignatureBytes: accountantBytes,
      headSignatureBytes: headBytes,
      recipientSignatureBytes,
      signedAt,
    });
    const { error: pdfUploadError } = await supabase.storage
      .from("slip-gaji")
      .upload(pdfPath, pdfBytes, {
        contentType: "application/pdf",
        cacheControl: "31536000",
        upsert: false,
      });
    if (pdfUploadError) throw new Error("Gagal menyimpan PDF final: " + pdfUploadError.message);
    pdfUploaded = true;

    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(pdfBytes));
    const { data: updated, error: updateError } = await supabase
      .from("Slip_Gaji")
      .update({
        TTD_Penerima_Path: recipientPath,
        Ditandatangani_Penerima_At: signedAt.toISOString(),
        PDF_Storage_Path: pdfPath,
        PDF_SHA256: bytesToHex(new Uint8Array(digest)),
        Status_Penerbitan: "DITERBITKAN",
        Dicetak_At: signedAt.toISOString(),
      })
      .eq("ID_Slip", idSlip)
      .eq("ID_User", session.idUser)
      .eq("Status_Penerbitan", "MENUNGGU_TTD_PENERIMA")
      .select("ID_Slip")
      .maybeSingle();
    if (updateError || !updated) throw new Error("Slip gagal difinalisasi. Muat ulang lalu coba kembali.");
    finalized = true;

    const { count: waitingCount, error: countError } = await supabase
      .from("Slip_Gaji")
      .select("ID_Slip", { count: "exact", head: true })
      .eq("ID_Payroll", slip.ID_Payroll)
      .eq("Status_Penerbitan", "MENUNGGU_TTD_PENERIMA");
    if (countError) {
      console.error("Gagal menghitung slip yang menunggu tanda tangan", countError.message);
    } else if ((waitingCount || 0) === 0) {
      const payrollUpdate = await supabase.from("Payroll")
        .update({ Status_Penerbitan: "DITERBITKAN" })
        .eq("ID_Payroll", slip.ID_Payroll);
      if (payrollUpdate.error) {
        console.error(JSON.stringify({
          code: "PAYROLL_FINAL_STATUS_DEFERRED",
          idPayroll: slip.ID_Payroll,
          error: payrollUpdate.error.message,
        }));
      }
    }

    await logAudit(supabase, "TANDA_TANGAN_PENERIMA_SLIP_GAJI", {
      idSlip,
      idPayroll: slip.ID_Payroll,
      pdfSha256: bytesToHex(new Uint8Array(digest)),
    }, session.idUser);
    return {
      success: true,
      idSlip,
      status: "DITERBITKAN",
      message: "Slip berhasil ditandatangani dan PDF final telah tersedia",
    };
  } catch (error) {
    if (!finalized) {
      if (pdfUploaded) await cleanupStorageBestEffort(supabase, "slip-gaji", [pdfPath], "REMOVE_FINAL_PDF_AFTER_FAILURE");
      if (recipientUploaded) await cleanupStorageBestEffort(supabase, "tanda-tangan", [recipientPath], "REMOVE_RECIPIENT_SIGNATURE_AFTER_FAILURE");
    }
    throw error;
  }
}

async function getSlipDownloadUrl(supabase: SupabaseClient, data: JsonRecord): Promise<JsonRecord> {
  const session = await validateSession(supabase, data.token);
  const idSlip = String(data.idSlip || "").trim();
  if (!idSlip) throw new Error("ID slip tidak ditemukan");
  const { data: slip, error } = await supabase
    .from("Slip_Gaji")
    .select("ID_Slip, ID_User, Periode_Mulai, Periode_Akhir, PDF_Storage_Path, URL_PDF_Slip, Status_Penerbitan")
    .eq("ID_Slip", idSlip)
    .maybeSingle();
  if (error) throw new Error("Gagal mengambil slip: " + error.message);
  if (!slip) throw new Error("Slip tidak ditemukan");
  if (slip.Status_Penerbitan === "MENUNGGU_TTD_PENERIMA") {
    throw new Error("Tandatangani slip sebagai penerima sebelum mengunduh PDF");
  }
  if (slip.Status_Penerbitan !== "DITERBITKAN") throw new Error("Slip belum tersedia");
  if (String(slip.ID_User) !== session.idUser) {
    if (!isAdminRole(session.role)) throw new Error("Akses ditolak");
    const scopedIds = await getScopedUserIds(supabase, session, [String(slip.ID_User)]);
    if (!scopedIds.has(String(slip.ID_User))) throw new Error("Slip berada di luar cakupan SPPG Anda");
  }

  const storagePath = String(slip.PDF_Storage_Path || "").trim();
  if (storagePath) {
    const filename = `slip-gaji-${safePath(slip.Periode_Mulai)}-${safePath(slip.Periode_Akhir)}.pdf`;
    const { data: signed, error: signedError } = await supabase.storage
      .from("slip-gaji")
      .createSignedUrl(storagePath, 300, { download: filename });
    if (signedError || !signed?.signedUrl) throw new Error("Gagal membuat tautan unduhan slip");
    await logAudit(supabase, "UNDUH_SLIP_GAJI", { idSlip }, session.idUser);
    return { success: true, url: signed.signedUrl, filename, expiresIn: 300 };
  }
  const legacyUrl = String(slip.URL_PDF_Slip || "");
  if (legacyUrl.startsWith("https://")) {
    return { success: true, url: legacyUrl, filename: `slip-gaji-${idSlip}.pdf`, expiresIn: 0 };
  }
  throw new Error("File PDF slip belum tersedia");
}

export async function handlePayrollSignatureWorkflow(
  functionName: string | undefined,
  data: JsonRecord,
  supabase: SupabaseClient,
): Promise<{ handled: boolean; result?: JsonRecord }> {
  if (!functionName || !HANDLED_FUNCTIONS.has(functionName)) return { handled: false };
  if (functionName === "prosesPayroll") return { handled: true, result: await processPayroll(supabase, data) };
  if (functionName === "getMyPayroll") return { handled: true, result: await getMyPayroll(supabase, data) };
  if (functionName === "getSlipDownloadUrl") {
    return { handled: true, result: await getSlipDownloadUrl(supabase, data) };
  }
  if (functionName === "signPayrollReceipt") {
    return { handled: true, result: await signPayrollReceipt(supabase, data) };
  }
  return { handled: false };
}
