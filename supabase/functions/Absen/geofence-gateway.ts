import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { handlePayrollSignatureWorkflow } from "./payroll-signature-workflow.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/AbsenCore`;
const MAX_RADIUS_METER = 100;
const DEFAULT_LOCATION_KEY = "DEFAULT";

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

function isActive(value: unknown): boolean {
  return value === true || value === 1 || ["TRUE", "1"].includes(String(value || "").toUpperCase());
}

function normalizeSppgKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^SPPG[\s_-]*/, "")
    .replace(/[^A-Z0-9]+/g, "");
}

function hitungJarakMeter(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadius = 6_371_000;
  const toRad = (degree: number) => degree * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface AuthenticatedUser {
  idUser: string;
  sppg: string;
  email: string;
  role: string;
  token: string;
}

interface LocationResult {
  valid: boolean;
  message?: string;
  distance: number | null;
  radius: number;
  referenceName: string;
  latitude: number | null;
  longitude: number | null;
}

async function authenticateUser(token: unknown): Promise<AuthenticatedUser> {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) throw new Error("SESI_HABIS");

  const { data: session, error: sessionError } = await supabase
    .from("Sessions")
    .select("Type, ID_User, Expires_At")
    .eq("Token", cleanToken)
    .maybeSingle();
  if (sessionError || !session || new Date(session.Expires_At).getTime() < Date.now()) {
    throw new Error("SESI_HABIS");
  }
  if (String(session.Type || "").toLowerCase() !== "user" || !session.ID_User) {
    throw new Error("Akses ditolak. Hanya untuk pengguna yang sudah login.");
  }

  const { data: user, error: userError } = await supabase
    .from("Users")
    .select("ID_User, SPPG, Email, Role, Status_Aktif")
    .eq("ID_User", session.ID_User)
    .maybeSingle();
  if (userError || !user || !isActive(user.Status_Aktif)) {
    throw new Error("AKUN_NONAKTIF");
  }

  return {
    idUser: String(user.ID_User),
    sppg: String(user.SPPG || ""),
    email: String(user.Email || ""),
    role: String(user.Role || "").trim().toUpperCase().replace(/_/g, " "),
    token: cleanToken,
  };
}

async function getScopedAttendanceUsers(auth: AuthenticatedUser): Promise<Array<{
  ID_User: string;
  SPPG: string | null;
}>> {
  if (!["ADMIN", "SUPER ADMIN", "AKUNTAN"].includes(auth.role)) {
    throw new Error("Akses ditolak.");
  }

  let query = supabase.from("Users").select("ID_User, SPPG, Role");
  if (auth.role !== "SUPER ADMIN") {
    const { data: accessRows, error: accessError } = await supabase
      .from("Akses_Email")
      .select("SPPG, Aktif")
      .ilike("Email", auth.email);
    if (accessError) throw new Error("Gagal membaca cakupan akses: " + accessError.message);

    const sppgList = [...new Set((accessRows || [])
      .filter((row: any) => isActive(row.Aktif))
      .map((row: any) => String(row.SPPG || "").trim())
      .filter(Boolean))];
    if (!sppgList.length) {
      return [{ ID_User: auth.idUser, SPPG: auth.sppg || null }];
    }
    query = query.in("SPPG", sppgList);
  }

  const { data: users, error } = await query;
  if (error) throw new Error("Gagal membaca cakupan pengguna: " + error.message);
  return (users || [])
    .filter((row: any) => String(row.Role || "").trim().toUpperCase().replace(/_/g, " ") !== "SUPER ADMIN")
    .map((row: any) => ({ ID_User: String(row.ID_User), SPPG: row.SPPG || null }));
}

function optionalIsoDate(value: unknown): string | null {
  const clean = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null;
}

async function handleFilteredAttendance(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  const scopedUsers = await getScopedAttendanceUsers(auth);
  const userIds = scopedUsers.map((row) => row.ID_User);
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(data.pageSize) || 20));
  const sppgOptions = [...new Set(scopedUsers.map((row) => String(row.SPPG || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "id"));

  if (!userIds.length) {
    return okResult({ absensi: [], total: 0, page, pageSize, filterOptions: { sppg: sppgOptions } });
  }

  const { data: result, error } = await supabase.rpc("get_absensi_grouped_page_v2", {
    p_user_ids: userIds,
    p_page: page,
    p_page_size: pageSize,
    p_search: String(data.search || "").trim() || null,
    p_start_date: optionalIsoDate(data.startDate),
    p_end_date: optionalIsoDate(data.endDate),
    p_sppg: String(data.sppg || "").trim() || null,
    p_status: String(data.status || "").trim() || null,
    p_source: String(data.source || "").trim() || null,
  });
  if (error) throw new Error("Gagal mengambil data absensi: " + error.message);

  return okResult({
    absensi: (result || []).map((item: any) => item.row_data),
    total: Number(result?.[0]?.total_count || 0),
    page,
    pageSize,
    filterOptions: { sppg: sppgOptions },
  });
}

function jakartaDateString(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalizeTicketStatus(value: unknown): string {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
}

function profileAssessment(user: any): { score: number; missing: string[] } {
  const requirements: Array<[string, unknown]> = [
    ["nama", user.Nama_Lengkap],
    ["email", user.Email],
    ["nomor WhatsApp", user.No_Whatsapp],
    ["SPPG", user.SPPG],
    ["jabatan/divisi", user.Jabatan_Divisi],
    ["gaji harian", Number(user.Gaji_Harian) > 0],
    ["bank", user.Nama_Bank],
    ["nomor rekening", user.Nomor_Rekening],
    ["atas nama rekening", user.Atas_Nama_Rekening],
    ["data wajah", user._hasFace || user.Face_Descriptor_JSON || user.URL_Foto_Wajah_Ref],
  ];
  const missing = requirements.filter(([, value]) => !value).map(([label]) => label);
  return { score: Math.round(((requirements.length - missing.length) / requirements.length) * 100), missing };
}

async function getScopedOperationalUsers(auth: AuthenticatedUser): Promise<any[]> {
  const scoped = await getScopedAttendanceUsers(auth);
  const ids = scoped.map((row) => row.ID_User);
  if (!ids.length) return [];
  const [usersResult, faceResult] = await Promise.all([
    supabase
      .from("Users")
      // Dashboard hanya memerlukan identitas dan indikator kelengkapan profil.
      .select("ID_User,Role,Status_Aktif,Nama_Lengkap,Email,No_Whatsapp,SPPG,Jabatan_Divisi,Gaji_Harian,Nama_Bank,Nomor_Rekening,Atas_Nama_Rekening,URL_Foto_Wajah_Ref")
      .in("ID_User", ids),
    supabase
      .from("Users")
      .select("ID_User")
      .in("ID_User", ids)
      .not("Face_Descriptor_JSON", "is", null),
  ]);
  if (usersResult.error) throw new Error("Gagal membaca data operasional pengguna: " + usersResult.error.message);
  if (faceResult.error) throw new Error("Gagal membaca status data wajah: " + faceResult.error.message);
  const usersWithFace = new Set((faceResult.data || []).map((row: any) => String(row.ID_User)));
  return (usersResult.data || []).map((row: any) => ({
    ...row,
    _hasFace: usersWithFace.has(String(row.ID_User)) || Boolean(row.URL_Foto_Wajah_Ref),
  }));
}

async function getPresenceMap(userIds: string[]): Promise<Map<string, { online: boolean; lastActivity: string | null }>> {
  const result = new Map<string, { online: boolean; lastActivity: string | null }>();
  if (!userIds.length) return result;
  const { data, error } = await supabase
    .from("Sessions")
    .select("ID_User, Last_Activity_At, Client_State, Expires_At")
    .eq("Type", "user")
    .in("ID_User", userIds)
    .order("Last_Activity_At", { ascending: false });
  if (error) throw new Error("Gagal membaca status online: " + error.message);
  const onlineThreshold = Date.now() - 2 * 60 * 1000;
  for (const row of data || []) {
    const id = String(row.ID_User || "");
    if (!id || result.has(id)) continue;
    const lastActivity = row.Last_Activity_At ? String(row.Last_Activity_At) : null;
    const online = Boolean(
      lastActivity &&
      new Date(lastActivity).getTime() >= onlineThreshold &&
      new Date(row.Expires_At).getTime() > Date.now() &&
      String(row.Client_State || "ACTIVE") === "ACTIVE"
    );
    result.set(id, { online, lastActivity });
  }
  return result;
}

async function handlePresenceHeartbeat(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  const clientState = String(data.clientState || "ACTIVE").toUpperCase() === "HIDDEN" ? "HIDDEN" : "ACTIVE";
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("Sessions")
    .update({ Last_Activity_At: now, Client_State: clientState })
    .eq("Token", auth.token);
  if (error) throw new Error("Gagal memperbarui status online: " + error.message);
  return okResult({ online: clientState === "ACTIVE", lastActivity: now });
}

async function handleOperationalUsers(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  const scoped = await getScopedAttendanceUsers(auth);
  const scopedIds = scoped.map((row) => row.ID_User);
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(data.pageSize) || 25));
  if (!scopedIds.length) return okResult({ users: [], total: 0, page, pageSize, filterOptions: {} });

  const columns = "ID_User,Username,Role,Status_Aktif,Nama_Lengkap,Tempat_Lahir,Tanggal_Lahir,Jenis_Kelamin,Email,No_Whatsapp,SPPG,Yayasan,Tanggal_Mulai_Kerja,Jabatan_Divisi,Gaji_Harian,Nama_Bank,Nomor_Rekening,Atas_Nama_Rekening,ID_Card_Unik,URL_Foto_Profil,URL_Foto_Wajah_Ref,Setuju_Kebijakan_Data,Created_At,Updated_At";
  let query = supabase.from("Users")
    .select(columns, { count: "exact" })
    .in("ID_User", scopedIds);
  const search = String(data.search || "").trim().replace(/[%(),]/g, " ").slice(0, 100);
  if (search) query = query.or(`Nama_Lengkap.ilike.%${search}%,SPPG.ilike.%${search}%,Jabatan_Divisi.ilike.%${search}%`);
  const role = String(data.role || "").trim();
  const sppg = String(data.sppg || "").trim();
  const division = String(data.division || "").trim();
  const account = String(data.account || "").trim().toUpperCase();
  if (role) query = query.eq("Role", role);
  if (sppg) query = query.eq("SPPG", sppg);
  if (division) query = query.eq("Jabatan_Divisi", division);
  if (account === "ACTIVE") query = query.eq("Status_Aktif", true);
  if (account === "INACTIVE") query = query.eq("Status_Aktif", false);
  const from = (page - 1) * pageSize;
  const usersResult = await query.order("Nama_Lengkap").range(from, from + pageSize - 1);
  if (usersResult.error) throw new Error("Gagal membaca data operasional pengguna: " + usersResult.error.message);
  const users = usersResult.data || [];
  const pageIds = users.map((user: any) => String(user.ID_User));
  const [faceResult, optionsResult] = await Promise.all([
    pageIds.length
      ? supabase.from("Users").select("ID_User").in("ID_User", pageIds).not("Face_Descriptor_JSON", "is", null)
      : Promise.resolve({ data: [], error: null }),
    // Opsi filter hanya memuat tiga kolom kecil, bukan seluruh profil.
    supabase.from("Users").select("Role,SPPG,Jabatan_Divisi").in("ID_User", scopedIds),
  ]);
  if (faceResult.error) throw new Error("Gagal membaca status data wajah: " + faceResult.error.message);
  if (optionsResult.error) throw new Error("Gagal membaca opsi filter pengguna: " + optionsResult.error.message);
  const usersWithFace = new Set((faceResult.data || []).map((row: any) => String(row.ID_User)));
  users.forEach((row: any) => {
    row._hasFace = usersWithFace.has(String(row.ID_User)) || Boolean(row.URL_Foto_Wajah_Ref);
  });
  const presence = await getPresenceMap(users.map((user) => String(user.ID_User)));
  const userIds = users.map((user) => String(user.ID_User));
  let todayPunches: any[] = [];
  if (userIds.length) {
    const { data: rows, error } = await supabase.from("Absensi").select("ID_User,Jenis_Absen,Status_Validasi")
      .in("ID_User", userIds).eq("Tanggal", jakartaDateString());
    if (error) throw new Error("Gagal membaca punch hari ini: " + error.message);
    todayPunches = rows || [];
  }
  const punchMap = new Map<string, any[]>();
  for (const row of todayPunches) {
    const id = String(row.ID_User);
    if (!punchMap.has(id)) punchMap.set(id, []);
    punchMap.get(id)!.push(row);
  }
  return okResult({
    total: usersResult.count || 0,
    page,
    pageSize,
    filterOptions: {
      roles: [...new Set((optionsResult.data || []).map((row: any) => String(row.Role || "")).filter(Boolean))].sort(),
      sppg: [...new Set((optionsResult.data || []).map((row: any) => String(row.SPPG || "")).filter(Boolean))].sort(),
      divisions: [...new Set((optionsResult.data || []).map((row: any) => String(row.Jabatan_Divisi || "")).filter(Boolean))].sort(),
    },
    users: users.map((user) => {
      const assessment = profileAssessment(user);
      const current = presence.get(String(user.ID_User));
      return {
        ...user,
        _online: Boolean(current?.online),
        _lastActivity: current?.lastActivity || null,
        _profileScore: assessment.score,
        _missingProfile: assessment.missing,
        _todayPunches: punchMap.get(String(user.ID_User)) || [],
      };
    }),
  });
}

async function handleOperationalDashboard(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  const users = (await getScopedOperationalUsers(auth))
    .filter((user) => String(user.Role || "").toUpperCase().replace(/_/g, " ") === "USER" && isActive(user.Status_Aktif));
  const ids = users.map((user) => String(user.ID_User));
  const today = jakartaDateString();
  const presence = await getPresenceMap(ids);

  let attendance: any[] = [];
  let complaints: any[] = [];
  let pendingSlips: any[] = [];
  if (ids.length) {
    const [attendanceResult, complaintResult, slipResult] = await Promise.all([
      supabase.from("Absensi")
        .select("ID_User, Jenis_Absen, Waktu_Timestamp")
        .in("ID_User", ids)
        .eq("Tanggal", today)
        .eq("Status_Validasi", "VALID"),
      supabase.from("Pengaduan")
        .select("ID_Pengaduan, User, Kategori, Status_Tiket, Prioritas, Timestamp")
        .in("User", ids)
        .neq("Status_Tiket", "SELESAI")
        .order("Timestamp", { ascending: false })
        .limit(20),
      supabase.from("Slip_Gaji")
        .select("ID_Slip, ID_User, Periode_Mulai, Periode_Akhir")
        .in("ID_User", ids)
        .eq("Status_Penerbitan", "MENUNGGU_TTD_PENERIMA")
        .order("Diterbitkan_At", { ascending: false })
        .limit(20),
    ]);
    if (attendanceResult.error) throw new Error("Gagal membaca absensi hari ini: " + attendanceResult.error.message);
    if (complaintResult.error) throw new Error("Gagal membaca tiket pengaduan: " + complaintResult.error.message);
    if (slipResult.error) throw new Error("Gagal membaca status payroll: " + slipResult.error.message);
    attendance = attendanceResult.data || [];
    complaints = complaintResult.data || [];
    pendingSlips = slipResult.data || [];
  }

  const punches = new Map<string, Set<string>>();
  for (const row of attendance) {
    const id = String(row.ID_User);
    if (!punches.has(id)) punches.set(id, new Set());
    punches.get(id)!.add(String(row.Jenis_Absen || ""));
  }
  const userMap = new Map(users.map((user) => [String(user.ID_User), user]));
  const summaryUser = (user: any) => ({
    idUser: String(user.ID_User),
    nama: String(user.Nama_Lengkap || "-"),
    jabatan: String(user.Jabatan_Divisi || "-"),
    sppg: String(user.SPPG || "-"),
  });
  const belumDatang = users.filter((user) => {
    const set = punches.get(String(user.ID_User));
    return !set?.has("DATANG") && !set?.has("PUNCH_TUNGGAL");
  }).map(summaryUser);
  const belumPulang = users.filter((user) => {
    const set = punches.get(String(user.ID_User));
    return set?.has("DATANG") && !set?.has("PULANG");
  }).map(summaryUser);
  const incompleteProfiles = users
    .map((user) => ({ ...summaryUser(user), ...profileAssessment(user) }))
    .filter((user) => user.score < 100)
    .sort((a, b) => a.score - b.score);
  const onlineCount = ids.filter((id) => presence.get(id)?.online).length;

  return okResult({
    date: today,
    totals: {
      employees: users.length,
      online: onlineCount,
      notArrived: belumDatang.length,
      notDeparted: belumPulang.length,
      incompleteProfiles: incompleteProfiles.length,
      openTickets: complaints.length,
      pendingRecipientSignatures: pendingSlips.length,
    },
    exceptions: {
      belumDatang: belumDatang.slice(0, 10),
      belumPulang: belumPulang.slice(0, 10),
      profilBelumLengkap: incompleteProfiles.slice(0, 10),
      tiketTerbuka: complaints.slice(0, 10).map((row) => ({
        ...row,
        nama: userMap.get(String(row.User))?.Nama_Lengkap || "Pengguna",
      })),
      slipMenungguTtd: pendingSlips.slice(0, 10).map((row) => ({
        ...row,
        nama: userMap.get(String(row.ID_User))?.Nama_Lengkap || "Pengguna",
      })),
    },
  });
}

async function handleUserNotifications(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  const { data: user, error: userError } = await supabase.from("Users")
    .select("Nama_Lengkap,Email,No_Whatsapp,SPPG,Jabatan_Divisi,Gaji_Harian,Nama_Bank,Nomor_Rekening,Atas_Nama_Rekening,URL_Foto_Wajah_Ref,Created_At,Updated_At")
    .eq("ID_User", auth.idUser)
    .maybeSingle();
  if (userError || !user) throw new Error("Profil pengguna tidak ditemukan.");
  const [slipsResult, complaintsResult] = await Promise.all([
    supabase.from("Slip_Gaji")
      .select("ID_Slip, Periode_Mulai, Periode_Akhir, Status_Penerbitan, Diterbitkan_At")
      .eq("ID_User", auth.idUser)
      .eq("Status_Penerbitan", "MENUNGGU_TTD_PENERIMA")
      .order("Diterbitkan_At", { ascending: false })
      .limit(20),
    supabase.from("Pengaduan")
      .select("ID_Pengaduan, Kategori, Status_Tiket, Tanggapan_Admin, Waktu_Tanggapan, Timestamp")
      .eq("User", auth.idUser)
      .order("Timestamp", { ascending: false })
      .limit(20),
  ]);
  if (slipsResult.error) throw new Error("Gagal membaca notifikasi payroll: " + slipsResult.error.message);
  if (complaintsResult.error) throw new Error("Gagal membaca notifikasi pengaduan: " + complaintsResult.error.message);

  const items: any[] = [];
  for (const slip of slipsResult.data || []) {
    items.push({
      id: `SLIP:${slip.ID_Slip}`,
      type: "PAYROLL",
      title: "Slip gaji menunggu tanda tangan",
      message: `Periode ${slip.Periode_Mulai} sampai ${slip.Periode_Akhir}`,
      actionView: "my-payroll",
      timestamp: slip.Diterbitkan_At,
      priority: "TINGGI",
    });
  }
  for (const complaint of complaintsResult.data || []) {
    if (!complaint.Tanggapan_Admin && complaint.Status_Tiket === "BARU") continue;
    items.push({
      id: `TIKET:${complaint.ID_Pengaduan}`,
      type: "PENGADUAN",
      title: complaint.Tanggapan_Admin ? "Ada perkembangan pengaduan" : "Status pengaduan berubah",
      message: `${complaint.ID_Pengaduan} · ${complaint.Status_Tiket || "BARU"}`,
      actionView: "pengaduan",
      timestamp: complaint.Waktu_Tanggapan || complaint.Timestamp,
      priority: complaint.Status_Tiket === "MENUNGGU_USER" ? "TINGGI" : "NORMAL",
    });
  }
  const assessment = profileAssessment(user);
  if (assessment.missing.length) {
    items.push({
      id: "PROFIL:BELUM_LENGKAP",
      type: "PROFIL",
      title: `Profil ${assessment.score}% lengkap`,
      message: `Lengkapi ${assessment.missing.slice(0, 3).join(", ")}`,
      actionView: "profil",
      timestamp: user.Updated_At || user.Created_At,
      priority: "NORMAL",
    });
  }
  items.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
  return okResult({ count: items.length, items: items.slice(0, 20) });
}

async function handleComplaintTicketUpdate(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  if (!["ADMIN", "SUPER ADMIN", "AKUNTAN"].includes(auth.role)) throw new Error("Akses ditolak.");
  const id = String(data.idPengaduan || "").trim();
  const status = normalizeTicketStatus(data.status);
  const priority = String(data.prioritas || "NORMAL").trim().toUpperCase();
  if (!id) throw new Error("ID pengaduan wajib diisi.");
  if (!["BARU", "DIPROSES", "MENUNGGU_USER", "SELESAI"].includes(status)) throw new Error("Status tiket tidak valid.");
  if (!["RENDAH", "NORMAL", "TINGGI", "MENDESAK"].includes(priority)) throw new Error("Prioritas tiket tidak valid.");
  const { data: target, error: targetError } = await supabase.from("Pengaduan").select("ID_Pengaduan, User").eq("ID_Pengaduan", id).maybeSingle();
  if (targetError || !target) throw new Error("Pengaduan tidak ditemukan.");
  if (auth.role !== "SUPER ADMIN") {
    const scoped = await getScopedAttendanceUsers(auth);
    if (!scoped.some((user) => user.ID_User === String(target.User))) throw new Error("Pengaduan di luar cakupan akses.");
  }
  const now = new Date().toISOString();
  const { error } = await supabase.from("Pengaduan").update({
    Status_Tiket: status,
    Prioritas: priority,
    Waktu_Status_At: now,
    Selesai_At: status === "SELESAI" ? now : null,
  }).eq("ID_Pengaduan", id);
  if (error) throw new Error("Gagal memperbarui tiket: " + error.message);
  await writeAudit("UPDATE_STATUS_TIKET", { idPengaduan: id, status, prioritas: priority }, auth.idUser);
  return okResult({ idPengaduan: id, status, prioritas: priority });
}

async function handleCloseMyComplaint(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  const id = String(data.idPengaduan || "").trim();
  if (!id) throw new Error("ID pengaduan wajib diisi.");
  const now = new Date().toISOString();
  const { data: updated, error } = await supabase.from("Pengaduan").update({
    Status_Tiket: "SELESAI",
    Waktu_Status_At: now,
    Selesai_At: now,
  }).eq("ID_Pengaduan", id).eq("User", auth.idUser).select("ID_Pengaduan").maybeSingle();
  if (error || !updated) throw new Error("Tiket tidak ditemukan atau bukan milik akun ini.");
  await writeAudit("USER_SELESAIKAN_TIKET", { idPengaduan: id }, auth.idUser);
  return okResult({ idPengaduan: id, status: "SELESAI" });
}

async function validateLocation(sppg: string, rawLat: unknown, rawLng: unknown): Promise<LocationResult> {
  if (rawLat === null || rawLat === undefined || rawLng === null || rawLng === undefined) {
    return {
      valid: false,
      message: "Lokasi GPS tidak terdeteksi. Aktifkan layanan lokasi dan coba lagi.",
      distance: null,
      radius: MAX_RADIUS_METER,
      referenceName: sppg || "SPPG",
      latitude: null,
      longitude: null,
    };
  }

  const latitude = Number(rawLat);
  const longitude = Number(rawLng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return {
      valid: false,
      message: "Koordinat GPS tidak valid. Muat ulang lokasi dan coba lagi.",
      distance: null,
      radius: MAX_RADIUS_METER,
      referenceName: sppg || "SPPG",
      latitude: null,
      longitude: null,
    };
  }

  const key = normalizeSppgKey(sppg);
  const keys = [...new Set([key, DEFAULT_LOCATION_KEY].filter(Boolean))];
  const { data: rows, error } = await supabase
    .from("Lokasi_SPPG")
    .select("Kunci_SPPG, Nama_SPPG, Latitude, Longitude, Radius_Meter, Aktif")
    .in("Kunci_SPPG", keys)
    .eq("Aktif", true);
  if (error) throw new Error("Gagal membaca konfigurasi lokasi SPPG: " + error.message);

  const exact = (rows || []).find((row: any) => row.Kunci_SPPG === key);
  const fallback = (rows || []).find((row: any) => row.Kunci_SPPG === DEFAULT_LOCATION_KEY);
  const reference: any = exact || fallback;
  if (!reference) throw new Error("Konfigurasi lokasi absensi belum tersedia. Hubungi Admin.");

  const radius = Math.min(MAX_RADIUS_METER, Math.max(1, Number(reference.Radius_Meter) || MAX_RADIUS_METER));
  const distance = Math.round(hitungJarakMeter(
    Number(reference.Latitude),
    Number(reference.Longitude),
    latitude,
    longitude,
  ));
  const valid = distance <= radius;

  return {
    valid,
    message: valid
      ? undefined
      : `Anda berada di luar radius lokasi SPPG ${sppg || reference.Nama_SPPG} (jarak: ${distance} meter, maksimal ${radius} meter).`,
    distance,
    radius,
    referenceName: String(reference.Nama_SPPG || sppg || "SPPG"),
    latitude,
    longitude,
  };
}

async function writeAudit(activity: string, detail: Record<string, unknown>, idUser: string): Promise<void> {
  try {
    await supabase.from("Audit_Log").insert({
      ID_Log: `LOG_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      Waktu: new Date().toISOString(),
      ID_User_Pelaku: idUser,
      Jenis_Aktivitas: activity,
      Detail: detail,
      IP_Address: "N/A",
    });
  } catch (error) {
    console.error("Geofence audit failed", error);
  }
}

function requireSuperAdmin(auth: AuthenticatedUser): void {
  if (auth.role !== "SUPER ADMIN") throw new Error("Akses hanya untuk SUPER ADMIN.");
}

async function handleSuperAdminOverview(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  requireSuperAdmin(auth);
  // Agregasi dilakukan di Postgres agar riwayat mentah tidak keluar dari database.
  const { data: overview, error } = await supabase.rpc("get_super_admin_overview_v4", {
    p_today: jakartaDateString(),
  });
  if (error) throw new Error("Gagal membaca dashboard global: " + error.message);
  return okResult(overview || {});
}

async function handleSuperAdminAudit(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  requireSuperAdmin(auth);
  const limit = Math.min(200, Math.max(20, Number(data.limit) || 100));
  let logQuery = supabase.from("Audit_Log")
    .select("ID_Log,Waktu,ID_User_Pelaku,Jenis_Aktivitas,Detail,IP_Address")
    .order("Waktu", { ascending: false })
    .limit(limit);
  const before = String(data.before || "").trim();
  if (before) logQuery = logQuery.lt("Waktu", before);
  const logsResult = await logQuery;
  if (logsResult.error) throw new Error(logsResult.error.message);
  const actorIds = [...new Set((logsResult.data || []).map((row: any) => String(row.ID_User_Pelaku || "")).filter(Boolean))];
  const usersResult = actorIds.length
    ? await supabase.from("Users").select("ID_User,Nama_Lengkap,Email,Role,SPPG").in("ID_User", actorIds)
    : { data: [], error: null };
  if (usersResult.error) throw new Error(usersResult.error.message);
  const users = new Map((usersResult.data || []).map((row: any) => [String(row.ID_User), row]));
  return okResult({ logs: (logsResult.data || []).map((log: any) => {
    const actor: any = users.get(String(log.ID_User_Pelaku)) || {};
    return { ...log, _pelakuNama: actor.Nama_Lengkap || "-", _pelakuEmail: actor.Email || "", _pelakuRole: actor.Role || "", _pelakuSppg: actor.SPPG || "" };
  }), nextCursor: logsResult.data?.length === limit ? logsResult.data.at(-1)?.Waktu || null : null });
}

const SYSTEM_SETTING_KEYS = new Set([
  "menu.user.complaints",
  "menu.admin.payroll",
  "menu.admin.audit",
  "attendance.geofence_required",
  "attendance.capture_gps_accuracy",
  "attendance.allow_import_single_punch",
  "attendance.correction_requires_audit",
  "payroll.recipient_signature_required",
  "payroll.accountant_signature_required",
  "payroll.head_signature_required",
  "payroll.private_pdf",
  "notification.new_slip",
  "notification.complaint_reply",
  "notification.incomplete_attendance",
  "notification.global_announcement",
  "security.idle_session_expiry",
  "security.revoke_on_password_reset",
  "security.risky_action_reason",
  "security.two_step_confirmation",
]);

function requireReason(value: unknown): string {
  const reason = String(value || "").trim();
  if (reason.length < 10) throw new Error("Alasan tindakan wajib diisi minimal 10 karakter.");
  if (reason.length > 500) throw new Error("Alasan tindakan maksimal 500 karakter.");
  return reason;
}

async function handleSystemSettings(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  requireSuperAdmin(auth);
  const mode = String(data.mode || "GET").toUpperCase();
  if (mode === "GET") {
    const { data: rows, error } = await supabase.from("System_Settings")
      .select("Setting_Key,Setting_Value,Description,Updated_At,Updated_By")
      .order("Setting_Key");
    if (error) throw new Error("Gagal membaca pengaturan sistem: " + error.message);
    return okResult({ settings: rows || [] });
  }
  const key = String(data.key || "").trim();
  if (!SYSTEM_SETTING_KEYS.has(key)) throw new Error("Kunci pengaturan tidak diizinkan.");
  const reason = requireReason(data.reason);
  const { data: before, error: beforeError } = await supabase.from("System_Settings")
    .select("Setting_Key,Setting_Value,Description,Updated_At,Updated_By")
    .eq("Setting_Key", key).maybeSingle();
  if (beforeError) throw new Error(beforeError.message);
  const after = {
    Setting_Key: key,
    Setting_Value: { enabled: Boolean(data.enabled) },
    Description: String(data.description || before?.Description || key).slice(0, 500),
    Updated_At: new Date().toISOString(),
    Updated_By: auth.idUser,
  };
  const { error } = await supabase.from("System_Settings").upsert(after, { onConflict: "Setting_Key" });
  if (error) throw new Error("Gagal menyimpan pengaturan: " + error.message);
  await writeAudit("UPDATE_SYSTEM_SETTING", { object: key, reason, before: before || null, after }, auth.idUser);
  return okResult({ setting: after });
}

async function handleRiskyRoleChange(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  requireSuperAdmin(auth);
  const reason = requireReason(data.reason);
  const idUser = String(data.idUser || "").trim();
  const role = String(data.role || "").trim().toUpperCase().replace(/_/g, " ");
  if (!idUser || !["USER", "ADMIN", "AKUNTAN"].includes(role)) throw new Error("Target atau role tidak valid.");
  if (idUser === auth.idUser) throw new Error("SUPER ADMIN tidak dapat mengubah role akunnya sendiri.");
  const { data: before, error: beforeError } = await supabase.from("Users")
    .select("ID_User,Nama_Lengkap,Email,Role,SPPG,Status_Aktif").eq("ID_User", idUser).maybeSingle();
  if (beforeError || !before) throw new Error("Akun target tidak ditemukan.");
  if (String(before.Role || "").toUpperCase().replace(/_/g, " ") === "SUPER ADMIN") throw new Error("Role SUPER ADMIN tidak dapat diubah melalui menu ini.");
  const { data: updated, error } = await supabase.from("Users").update({ Role: role, Updated_At: new Date().toISOString() })
    .eq("ID_User", idUser).select("ID_User,Nama_Lengkap,Email,Role,SPPG,Status_Aktif").single();
  if (error) throw new Error("Gagal memperbarui role: " + error.message);
  await supabase.from("Sessions").delete().eq("ID_User", idUser);
  await writeAudit("UPDATE_ROLE_RISKY", { object: `Users:${idUser}`, reason, before, after: updated }, auth.idUser);
  return okResult({ message: "Role berhasil diperbarui dan sesi aktif dicabut.", user: updated });
}

async function handleRiskyAccessDelete(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  requireSuperAdmin(auth);
  const reason = requireReason(data.reason);
  const id = String(data.idAkses || "").trim();
  const { data: before, error: beforeError } = await supabase.from("Akses_Email")
    .select("ID_Akses,Email,SPPG,Aktif,Created_At").eq("ID_Akses", id).maybeSingle();
  if (beforeError || !before) throw new Error("Mapping akses tidak ditemukan.");
  const { error } = await supabase.from("Akses_Email").delete().eq("ID_Akses", id);
  if (error) throw new Error("Gagal menghapus akses: " + error.message);
  await writeAudit("DELETE_ACCESS_RISKY", { object: `Akses_Email:${id}`, reason, before, after: null }, auth.idUser);
  return okResult({ message: "Cakupan akses berhasil dihapus." });
}

async function handleRiskyAccessSave(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  requireSuperAdmin(auth);
  const reason = requireReason(data.reason);
  const email = String(data.email || "").trim().toLowerCase();
  const sppg = String(data.sppg || "").trim();
  if (!email.includes("@") || !sppg) throw new Error("Email atau cakupan SPPG tidak valid.");
  const accessColumns = "ID_Akses,Email,SPPG,Aktif,Created_At";
  const { data: before, error: beforeError } = await supabase.from("Akses_Email").select(accessColumns)
    .ilike("Email", email).eq("SPPG", sppg).maybeSingle();
  if (beforeError) throw new Error(beforeError.message);
  let after: any = null;
  if (before) {
    const result = await supabase.from("Akses_Email").update({ Aktif: true }).eq("ID_Akses", before.ID_Akses).select(accessColumns).single();
    if (result.error) throw new Error("Gagal memperbarui akses: " + result.error.message);
    after = result.data;
  } else {
    const result = await supabase.from("Akses_Email").insert({ Email: email, SPPG: sppg, Aktif: true }).select(accessColumns).single();
    if (result.error) throw new Error("Gagal menambahkan akses: " + result.error.message);
    after = result.data;
  }
  await writeAudit("SAVE_ACCESS_RISKY", { object: `Akses_Email:${after.ID_Akses}`, reason, before: before || null, after }, auth.idUser);
  return okResult({ message: "Cakupan akses berhasil disimpan.", access: after });
}

async function handleRiskyUserDelete(body: { function?: string; data?: Record<string, unknown> }): Promise<Response> {
  const data = body.data || {};
  const auth = await authenticateUser(data.token);
  const reason = requireReason(data.reason);
  const idUser = String(data.id || "").trim();
  if (!idUser || idUser === auth.idUser) throw new Error("Target penghapusan tidak valid.");
  const scopedUsers = await getScopedOperationalUsers(auth);
  if (!scopedUsers.some((row) => String(row.ID_User) === idUser)) throw new Error("Akun target berada di luar cakupan.");
  const { data: before, error } = await supabase.from("Users").select("ID_User,Nama_Lengkap,Email,Role,SPPG,Status_Aktif")
    .eq("ID_User", idUser).maybeSingle();
  if (error || !before) throw new Error("Akun target tidak ditemukan.");
  if (String(before.Role || "").toUpperCase().replace(/_/g, " ") === "SUPER ADMIN") throw new Error("Akun SUPER ADMIN tidak dapat dihapus.");
  const response = await forwardToCore(body);
  let payload: any = null;
  try { payload = await response.clone().json(); } catch { /* respons core tetap diteruskan */ }
  if (payload?.success && payload?.result?.success) {
    await writeAudit("DELETE_USER_RISKY", { object: `Users:${idUser}`, reason, before, after: null }, auth.idUser);
  }
  return response;
}

async function handleAttendanceValidation(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  if (!["ADMIN", "SUPER ADMIN"].includes(auth.role)) throw new Error("Akses ditolak.");
  const reason = requireReason(data.reason);
  const action = String(data.action || "").toUpperCase();
  if (!["VALID", "DITOLAK", "PERLU_KOREKSI"].includes(action)) throw new Error("Aksi validasi tidak valid.");
  const items = Array.isArray(data.items) ? data.items.slice(0, 100) : [];
  if (!items.length) throw new Error("Pilih minimal satu data absensi.");
  const scopedUsers = await getScopedAttendanceUsers(auth);
  const allowedIds = new Set(scopedUsers.map((row) => row.ID_User));
  const results: any[] = [];
  for (const item of items) {
    const idUser = String(item?.idUser || "").trim();
    const date = optionalIsoDate(item?.tanggal);
    if (!allowedIds.has(idUser) || !date) throw new Error("Data absensi di luar cakupan atau tanggal tidak valid.");
    const { data: before, error: beforeError } = await supabase.from("Absensi")
      .select("ID_Absen,ID_User,Tanggal,Jenis_Absen,Status_Validasi,Catatan_Validasi")
      .eq("ID_User", idUser).eq("Tanggal", date);
    if (beforeError) throw new Error(beforeError.message);
    const { data: after, error } = await supabase.from("Absensi")
      .update({ Status_Validasi: action, Catatan_Validasi: reason })
      .eq("ID_User", idUser).eq("Tanggal", date)
      .select("ID_Absen,ID_User,Tanggal,Jenis_Absen,Status_Validasi,Catatan_Validasi");
    if (error) throw new Error("Validasi absensi gagal: " + error.message);
    results.push({ idUser, date, updated: after?.length || 0 });
    await writeAudit("BULK_ATTENDANCE_VALIDATION", {
      object: `Absensi:${idUser}:${date}`,
      action,
      reason,
      before: before || [],
      after: after || [],
    }, auth.idUser);
  }
  return okResult({ message: `${results.reduce((sum, row) => sum + row.updated, 0)} punch berhasil diperbarui.`, results });
}

function coreCompatibilityPoint(sppg: string, actualLat: number, actualLng: number): { lat: number; lng: number } {
  const key = normalizeSppgKey(sppg);
  if (key === "CISITU") return { lat: -6.889491, lng: 108.044861 };
  if (["DARMARAJA", "TANJUNGMEDAR", "CIAMIS", "PAKUALAM", "CIAWI", "CINTAJAYA", "KIRISIK"].includes(key)) {
    return { lat: -6.9186993373214465, lng: 108.07174565889278 };
  }
  return { lat: actualLat, lng: actualLng };
}

async function forwardToCore(body: unknown): Promise<Response> {
  const response = await fetch(CORE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function handleLocationCheck(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  const result = await validateLocation(auth.sppg, data.lat, data.lng);
  const accuracy = data.accuracy == null ? null : Number(data.accuracy);

  if (!result.valid) {
    await writeAudit("CEK_LOKASI_ABSEN_DITOLAK", {
      sppg: auth.sppg,
      latitude: result.latitude,
      longitude: result.longitude,
      akurasiGpsMeter: accuracy,
      jarakMeter: result.distance,
      radiusMeter: result.radius,
      titikReferensi: result.referenceName,
    }, auth.idUser);
  }

  return okResult({
    valid: result.valid,
    message: result.message,
    jarak: result.distance,
    radius: result.radius,
    sppg: auth.sppg,
    titikReferensi: result.referenceName,
  });
}

async function handleRecordAttendance(body: { function?: string; data?: Record<string, unknown> }): Promise<Response> {
  const data = body.data || {};
  const auth = await authenticateUser(data.token);
  const requestedId = String(data.idUser || auth.idUser);
  if (requestedId !== auth.idUser) {
    throw new Error("Akses ditolak. Identitas absensi tidak sesuai dengan sesi login.");
  }

  const result = await validateLocation(auth.sppg, data.lat, data.lng);
  const accuracy = data.accuracy == null ? null : Number(data.accuracy);
  if (!result.valid) {
    await writeAudit("ABSEN_MANDIRI_DITOLAK_LOKASI", {
      sppg: auth.sppg,
      latitude: result.latitude,
      longitude: result.longitude,
      akurasiGpsMeter: accuracy,
      jarakMeter: result.distance,
      radiusMeter: result.radius,
      titikReferensi: result.referenceName,
    }, auth.idUser);
    return okResult({ success: false, message: result.message });
  }

  const compatibility = coreCompatibilityPoint(auth.sppg, result.latitude!, result.longitude!);
  const forwardedBody = {
    ...body,
    data: {
      ...data,
      idUser: auth.idUser,
      lat: compatibility.lat,
      lng: compatibility.lng,
    },
  };

  const coreResponse = await fetch(CORE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(forwardedBody),
  });
  const responseText = await coreResponse.text();

  let payload: any = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    return new Response(responseText, {
      status: coreResponse.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (payload?.success && payload?.result?.success) {
    const { data: latest } = await supabase
      .from("Absensi")
      .select("ID_Absen")
      .eq("ID_User", auth.idUser)
      .eq("ID_Device", `SELF_${auth.idUser}`)
      .order("Waktu_Timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.ID_Absen) {
      const { error: updateError } = await supabase
        .from("Absensi")
        .update({
          Latitude: result.latitude,
          Longitude: result.longitude,
          Akurasi_GPS_Meter: Number.isFinite(accuracy) ? accuracy : null,
          Jarak_Lokasi_Meter: result.distance,
          Radius_Maksimum_Meter: result.radius,
          Lokasi_SPPG_Referensi: result.referenceName,
        })
        .eq("ID_Absen", latest.ID_Absen);
      if (updateError) console.error("Gagal menyimpan metadata GPS absensi", updateError.message);
    }

    await writeAudit("GEOFENCE_ABSEN_VALID", {
      sppg: auth.sppg,
      latitude: result.latitude,
      longitude: result.longitude,
      akurasiGpsMeter: accuracy,
      jarakMeter: result.distance,
      radiusMeter: result.radius,
      titikReferensi: result.referenceName,
    }, auth.idUser);
  }

  return new Response(JSON.stringify(payload), {
    status: coreResponse.status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errResult("Method tidak didukung. Gunakan POST.", 405);

  let body: { function?: string; data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return errResult("Body request harus berupa JSON valid.");
  }

  try {
    if (body.function === "checkAttendanceLocation") {
      return await handleLocationCheck(body.data || {});
    }
    if (body.function === "recordAbsensiSelf") {
      return await handleRecordAttendance(body);
    }
    if (body.function === "getAbsensiGroupedDataV2") {
      return await handleFilteredAttendance(body.data || {});
    }
    if (body.function === "presenceHeartbeat") {
      return await handlePresenceHeartbeat(body.data || {});
    }
    if (body.function === "getOperationalUsersV2") {
      return await handleOperationalUsers(body.data || {});
    }
    if (body.function === "getOperationalDashboardV2") {
      return await handleOperationalDashboard(body.data || {});
    }
    if (body.function === "getSuperAdminOverviewV3") {
      return await handleSuperAdminOverview(body.data || {});
    }
    if (body.function === "getSuperAdminAuditV3") {
      return await handleSuperAdminAudit(body.data || {});
    }
    if (body.function === "manageSystemSettingsV3") {
      return await handleSystemSettings(body.data || {});
    }
    if (body.function === "setConfiguredUserRole") {
      return await handleRiskyRoleChange(body.data || {});
    }
    if (body.function === "saveAksesEmail") {
      return await handleRiskyAccessSave(body.data || {});
    }
    if (body.function === "deleteAksesEmail") {
      return await handleRiskyAccessDelete(body.data || {});
    }
    if (body.function === "validateAttendanceBulkV3") {
      return await handleAttendanceValidation(body.data || {});
    }
    if (body.function === "deleteData" && String(body.data?.menu || "").toLowerCase() === "users") {
      return await handleRiskyUserDelete(body);
    }
    if (body.function === "getUserNotificationsV2") {
      return await handleUserNotifications(body.data || {});
    }
    if (body.function === "updateComplaintTicketV2") {
      return await handleComplaintTicketUpdate(body.data || {});
    }
    if (body.function === "closeMyComplaintTicketV2") {
      return await handleCloseMyComplaint(body.data || {});
    }
    const payrollWorkflow = await handlePayrollSignatureWorkflow(body.function, body.data || {}, supabase);
    if (payrollWorkflow.handled) {
      return okResult(payrollWorkflow.result);
    }
    return await forwardToCore(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Geofence gateway error (${body.function || "unknown"})`, error);
    return errResult(message);
  }
});
