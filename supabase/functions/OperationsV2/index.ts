import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  type AuthenticatedUser,
  authenticateUserSession,
  requireOperationalRole,
  requireSuperAdminRole,
} from "../_shared/auth.ts";
import { corsHeaders, createRequestId, isOriginAllowed, jsonResponse } from "../_shared/http.ts";
import { optionalString, requiredString, ValidationError } from "../_shared/validation.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const corsOptions = {
  allowedOriginsEnv: Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "",
  productionOrigin: "https://hadirly.org",
  previewSuffix: ".absen-sppg.pages.dev",
  localOrigins: ["http://localhost:4173", "http://127.0.0.1:4173"],
};

const USER_SAFE_COLUMNS = [
  "ID_User", "Username", "Role", "Status_Aktif", "Nama_Lengkap", "Tempat_Lahir", "Tanggal_Lahir",
  "Jenis_Kelamin", "Email", "No_Whatsapp", "SPPG", "Yayasan", "Tanggal_Mulai_Kerja", "Jabatan_Divisi",
  "Gaji_Harian", "Nama_Bank", "Atas_Nama_Rekening", "Nomor_Rekening", "ID_Card_Unik", "URL_Foto_Profil",
  "URL_Foto_Profil_Asli", "URL_Foto_Wajah_Ref", "Setuju_Kebijakan_Data", "Created_At", "Updated_At",
  "Akun_Dibekukan", "NIK", "Alamat",
].join(",");

const ATTENDANCE_VALIDATION_ACTIONS = new Set(["VALID", "PERLU_KOREKSI", "DITOLAK"]);
const ATTENDANCE_VIEW_STATUSES = new Set(["LENGKAP", "PUNCH_TUNGGAL", "BELUM_LENGKAP"]);
const normalize = (value: unknown) => String(value ?? "").trim().toUpperCase().replace(/_/g, " ");
const activeValue = (value: unknown) =>
  value === true || value === 1 || ["TRUE", "1", "ACTIVE", "AKTIF"].includes(normalize(value));
const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const jakartaDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const dateOnly = (value: unknown) => String(value ?? "").slice(0, 10);

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError("INVALID_BOOLEAN", `${field} wajib berupa boolean.`, field);
  }
  return value;
}

function plainObject(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("INVALID_OBJECT", `${field} wajib berupa object.`, field);
  }
  return value as Record<string, unknown>;
}

function optionalIsoDateTime(value: unknown, field: string): string | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const raw = requiredString(value, field, { max: 80 });
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError("INVALID_DATETIME", `${field} tidak valid.`, field);
  }
  return parsed.toISOString();
}

function workflowStatus(value: unknown, field: string): string {
  const raw = requiredString(value, field, { max: 50 }).trim().toUpperCase().replace(/\s+/g, "_");
  if (!/^[A-Z0-9_]{2,50}$/.test(raw)) {
    throw new ValidationError("INVALID_WORKFLOW_STATUS", `${field} tidak valid.`, field);
  }
  return raw;
}

async function actorProfile(auth: AuthenticatedUser) {
  const result = await db.from("Users").select("ID_User,Email,SPPG,Role").eq("ID_User", auth.idUser).maybeSingle();
  if (result.error || !result.data) throw new Error("ACCOUNT_INACTIVE");
  return result.data as Record<string, unknown>;
}

async function allowedSppg(auth: AuthenticatedUser): Promise<string[] | null> {
  if (auth.role === "SUPER ADMIN") return null;
  const actor = await actorProfile(auth);
  const values = new Set<string>();
  const direct = String(actor.SPPG || "").trim();
  if (direct) values.add(direct);
  const email = String(actor.Email || "").trim();
  if (email) {
    const access = await db.from("Akses_Email").select("SPPG,Aktif").ilike("Email", email);
    if (access.error) throw access.error;
    for (const row of access.data || []) {
      if (!activeValue(row.Aktif)) continue;
      const sppg = String(row.SPPG || "").trim();
      if (sppg) values.add(sppg);
    }
  }
  return [...values];
}

async function scopedUsers(scope: string[] | null): Promise<Record<string, unknown>[]> {
  if (scope && scope.length === 0) return [];
  let query = db.from("Users").select(USER_SAFE_COLUMNS).order("Nama_Lengkap", { ascending: true });
  if (scope) query = query.in("SPPG", scope);
  const result = await query;
  if (result.error) throw result.error;
  return (result.data || []) as unknown as Record<string, unknown>[];
}

function profileMissing(row: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!String(row.Nama_Lengkap || "").trim()) missing.push("Nama");
  if (!String(row.Email || row.Username || "").trim()) missing.push("Email");
  if (!String(row.No_Whatsapp || "").trim()) missing.push("No. WhatsApp");
  if (!String(row.SPPG || "").trim()) missing.push("SPPG");
  if (!String(row.Jabatan_Divisi || "").trim()) missing.push("Jabatan / Divisi");
  if (!String(row.Tanggal_Mulai_Kerja || "").trim()) missing.push("Tanggal Mulai Kerja");
  if (Number(row.Gaji_Harian || 0) <= 0) missing.push("Gaji Harian");
  if (!String(row.Nama_Bank || "").trim()) missing.push("Bank");
  if (!String(row.Nomor_Rekening || "").trim()) missing.push("Nomor Rekening");
  if (!String(row.URL_Foto_Profil || "").trim()) missing.push("Foto Profil");
  return missing;
}
const profileScore = (row: Record<string, unknown>) => Math.round((10 - profileMissing(row).length) * 10);

async function presenceFor(ids: string[]) {
  const latest = new Map<string, string>();
  const online = new Set<string>();
  if (!ids.length) return { latest, online };
  const sessions = await db.from("Sessions")
    .select("ID_User,Expires_At,Last_Activity_At,Created_At")
    .in("ID_User", ids)
    .gt("Expires_At", new Date().toISOString());
  if (sessions.error) throw sessions.error;
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const row of sessions.data || []) {
    const id = String(row.ID_User || "");
    const activity = String(row.Last_Activity_At || row.Created_At || "");
    if (!id || !activity) continue;
    const previous = latest.get(id);
    if (!previous || new Date(activity).getTime() > new Date(previous).getTime()) latest.set(id, activity);
    if (new Date(activity).getTime() >= cutoff) online.add(id);
  }
  return { latest, online };
}

async function todayPunches(ids: string[]) {
  const punches = new Map<string, Record<string, unknown>[]>();
  if (!ids.length) return punches;
  const attendance = await db.from("Absensi")
    .select("ID_User,Jenis_Absen,Waktu_Timestamp,Tanggal")
    .in("ID_User", ids)
    .eq("Tanggal", jakartaDate())
    .order("Waktu_Timestamp", { ascending: true });
  if (attendance.error) throw attendance.error;
  for (const row of attendance.data || []) {
    const id = String(row.ID_User || "");
    if (!id) continue;
    const current = punches.get(id) || [];
    current.push(row as Record<string, unknown>);
    punches.set(id, current);
  }
  return punches;
}

const hasArrival = (rows: Record<string, unknown>[]) =>
  rows.some((row) => ["DATANG", "MASUK", "IN"].includes(normalize(row.Jenis_Absen)));
const hasDeparture = (rows: Record<string, unknown>[]) =>
  rows.some((row) => ["PULANG", "KELUAR", "OUT"].includes(normalize(row.Jenis_Absen)));

async function operationalUsers(body: Record<string, unknown>, auth: AuthenticatedUser) {
  requireOperationalRole(auth);
  const scope = await allowedSppg(auth);
  const allUsers = await scopedUsers(scope);
  const filterOptions = {
    roles: [...new Set(allUsers.map((row) => normalize(row.Role)).filter(Boolean))].sort(),
    sppg: [...new Set(allUsers.map((row) => String(row.SPPG || "").trim()).filter(Boolean))].sort(),
    divisions: [...new Set(allUsers.map((row) => String(row.Jabatan_Divisi || "").trim()).filter(Boolean))].sort(),
  };
  const search = String(body.search || "").trim().toLowerCase();
  const role = normalize(body.role);
  const sppg = String(body.sppg || "").trim();
  const division = String(body.division || "").trim();
  const account = normalize(body.account);
  if (account && !["ACTIVE", "INACTIVE"].includes(account)) {
    throw new ValidationError("INVALID_ACCOUNT_FILTER", "Filter status akun tidak valid.", "account");
  }
  let filtered = allUsers.filter((row) => {
    if (search) {
      const haystack = [row.Nama_Lengkap, row.Email, row.Username, row.SPPG, row.Jabatan_Divisi]
        .map((value) => String(value || "").toLowerCase()).join(" ");
      if (!haystack.includes(search)) return false;
    }
    if (role && normalize(row.Role) !== role) return false;
    if (sppg && String(row.SPPG || "") !== sppg) return false;
    if (division && String(row.Jabatan_Divisi || "") !== division) return false;
    const active = activeValue(row.Status_Aktif);
    if (account === "ACTIVE" && !active) return false;
    if (account === "INACTIVE" && active) return false;
    return true;
  });
  const total = filtered.length;
  const page = clampInt(body.page, 1, 1, 100000);
  const pageSize = clampInt(body.pageSize, 24, 1, 200);
  filtered = filtered.slice((page - 1) * pageSize, page * pageSize);
  const ids = filtered.map((row) => String(row.ID_User || "")).filter(Boolean);
  const [presence, punches] = await Promise.all([presenceFor(ids), todayPunches(ids)]);
  const users = filtered.map((row) => {
    const id = String(row.ID_User || "");
    return {
      ...row,
      _online: presence.online.has(id),
      _lastActivity: presence.latest.get(id) || null,
      _todayPunches: punches.get(id) || [],
      _profileScore: profileScore(row),
      _hasFace: Boolean(String(row.URL_Foto_Wajah_Ref || "").trim()),
    };
  });
  return { users, total, filterOptions };
}

async function operationalDashboard(auth: AuthenticatedUser) {
  requireOperationalRole(auth);
  const scope = await allowedSppg(auth);
  const users = await scopedUsers(scope);
  const employees = users.filter((row) => normalize(row.Role) === "USER" && activeValue(row.Status_Aktif));
  const ids = employees.map((row) => String(row.ID_User || "")).filter(Boolean);
  const [presence, punches] = await Promise.all([presenceFor(ids), todayPunches(ids)]);
  const belumDatang: Array<Record<string, unknown>> = [];
  const belumPulang: Array<Record<string, unknown>> = [];
  const profilBelumLengkap: Array<Record<string, unknown>> = [];
  for (const row of employees) {
    const id = String(row.ID_User || "");
    const today = punches.get(id) || [];
    const summary = {
      idUser: id,
      nama: String(row.Nama_Lengkap || "-") || "-",
      jabatan: String(row.Jabatan_Divisi || "-") || "-",
      sppg: String(row.SPPG || "-") || "-",
    };
    if (!hasArrival(today)) belumDatang.push(summary);
    else if (!hasDeparture(today)) belumPulang.push(summary);
    const missing = profileMissing(row);
    if (missing.length) profilBelumLengkap.push({ ...summary, missing, score: profileScore(row) });
  }

  let complaintQuery = db.from("Pengaduan").select("ID_Pengaduan,SPPG,Status_Tiket").limit(5000);
  let slipQuery = db.from("Slip_Gaji")
    .select("ID_Slip,ID_User,SPPG,Status_Penerbitan")
    .eq("Status_Penerbitan", "MENUNGGU_TTD_PENERIMA")
    .limit(5000);
  if (scope) {
    if (!scope.length) {
      complaintQuery = complaintQuery.eq("ID_Pengaduan", "__NO_SCOPE__");
      slipQuery = slipQuery.eq("ID_Slip", "__NO_SCOPE__");
    } else {
      complaintQuery = complaintQuery.in("SPPG", scope);
      slipQuery = slipQuery.in("SPPG", scope);
    }
  }
  const [complaints, slips] = await Promise.all([complaintQuery, slipQuery]);
  if (complaints.error) throw complaints.error;
  if (slips.error) throw slips.error;
  const openTickets = (complaints.data || []).filter((row) =>
    !["SELESAI", "DITUTUP", "CLOSED", "CLOSE"].includes(normalize(row.Status_Tiket))
  ).length;
  return {
    totals: {
      employees: employees.length,
      online: presence.online.size,
      notArrived: belumDatang.length,
      notDeparted: belumPulang.length,
      incompleteProfiles: profilBelumLengkap.length,
      openTickets,
      pendingRecipientSignatures: (slips.data || []).length,
    },
    exceptions: { belumDatang, belumPulang, profilBelumLengkap },
  };
}

function attendanceSources(row: Record<string, any>): string[] {
  const direct = Array.isArray(row.sumber) ? row.sumber : [];
  const fromPunches = Array.isArray(row.punches)
    ? row.punches.map((punch: Record<string, any>) => punch.sumber || punch.Sumber_Data).filter(Boolean)
    : [];
  return [...new Set([...direct, ...fromPunches].map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeAttendanceRow(row: Record<string, any>): Record<string, any> {
  const punches = (Array.isArray(row.punches) ? row.punches : []).map((punch: Record<string, any>) => {
    const rawStatus = String(punch.status || punch.Status_Validasi || "").trim().toUpperCase();
    const status = ["INVALID", "TIDAK_VALID", "TIDAK VALID"].includes(rawStatus) ? "DITOLAK" : rawStatus;
    return { ...punch, ...(status ? { status } : {}) };
  });
  return { ...row, punches, sumber: attendanceSources({ ...row, punches }) };
}

async function groupedAttendanceV2(body: Record<string, unknown>, auth: AuthenticatedUser) {
  requireOperationalRole(auth);
  const page = clampInt(body.page, 1, 1, 100000);
  const pageSize = clampInt(body.pageSize, 20, 1, 100);
  const search = String(body.search || "").trim();
  const startDate = body.startDate ? dateOnly(body.startDate) : "";
  const endDate = body.endDate ? dateOnly(body.endDate) : "";
  if (body.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new ValidationError("INVALID_START_DATE", "Tanggal mulai tidak valid.", "startDate");
  if (body.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new ValidationError("INVALID_END_DATE", "Tanggal akhir tidak valid.", "endDate");
  if (startDate && endDate && endDate < startDate) throw new ValidationError("INVALID_DATE_RANGE", "Tanggal akhir tidak boleh sebelum tanggal mulai.", "endDate");
  const sppg = String(body.sppg || "").trim();
  const source = body.source ? requiredString(body.source, "source", { max: 100 }).toUpperCase() : "";
  const status = body.status ? requiredString(body.status, "status", { max: 40 }).toUpperCase() : "";
  if (status && !ATTENDANCE_VIEW_STATUSES.has(status)) throw new ValidationError("INVALID_ATTENDANCE_STATUS", "Filter status absensi tidak valid.", "status");
  const scope = await allowedSppg(auth);
  const users = await scopedUsers(scope);
  const scopedIds = users.map((row) => String(row.ID_User || "")).filter(Boolean);
  const filterOptions = { sppg: [...new Set(users.map((row) => String(row.SPPG || "").trim()).filter(Boolean))].sort() };
  if (!scopedIds.length) return { absensi: [], total: 0, page, pageSize, filterOptions };
  const result = await db.rpc("get_absensi_grouped_page_v2", {
    p_user_ids: scopedIds, p_page: page, p_page_size: pageSize, p_search: search || null,
    p_start_date: startDate || null, p_end_date: endDate || null, p_sppg: sppg || null,
    p_status: status || null, p_source: source || null,
  });
  if (result.error) throw new Error(`ATTENDANCE_QUERY_FAILED:${result.error.message}`);
  const rows = (result.data || []).map((item: any) => normalizeAttendanceRow(item.row_data || {}));
  return { absensi: rows, total: Number(result.data?.[0]?.total_count || 0), page, pageSize, filterOptions };
}

async function validateAttendanceBulkV3(body: Record<string, unknown>, auth: AuthenticatedUser) {
  requireOperationalRole(auth);
  const action = String(body.action || "").trim().toUpperCase();
  if (!ATTENDANCE_VALIDATION_ACTIONS.has(action)) throw new ValidationError("INVALID_ATTENDANCE_ACTION", "Aksi validasi absensi tidak valid.", "action");
  const reason = requiredString(body.reason, "reason", { min: 10, max: 2000 });
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) {
    throw new ValidationError("INVALID_ATTENDANCE_ITEMS", "Pilih 1 sampai 100 data absensi.", "items");
  }

  const scope = await allowedSppg(auth);
  const allowedIds = new Set((await scopedUsers(scope)).map((row) => String(row.ID_User || "")));
  const items = body.items.map((item: any) => ({
    idUser: requiredString(item?.idUser, "idUser", { max: 120 }),
    tanggal: dateOnly(item?.tanggal),
  }));
  for (const item of items) {
    if (!allowedIds.has(item.idUser)) throw new Error("FORBIDDEN");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.tanggal)) throw new ValidationError("INVALID_ATTENDANCE_DATE", "Tanggal absensi tidak valid.", "tanggal");
  }

  const dbStatus = action === "DITOLAK" ? "TIDAK_VALID" : action;
  let updatedRows = 0;
  for (const item of items) {
    const update = await db.from("Absensi")
      .update({ Status_Validasi: dbStatus })
      .eq("ID_User", item.idUser)
      .eq("Tanggal", item.tanggal)
      .select("ID_Absen");
    if (update.error) throw new Error(`ATTENDANCE_UPDATE_FAILED:${update.error.message}`);
    updatedRows += (update.data || []).length;
  }

  const audit = await db.from("Audit_Log").insert({
    ID_Log: `AUD_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    Waktu: new Date().toISOString(),
    ID_User_Pelaku: auth.idUser,
    Jenis_Aktivitas: "VALIDASI_ABSENSI_MASSAL",
    Detail: { action, storedStatus: dbStatus, reason, items, updatedRows },
  });
  if (audit.error) console.error(JSON.stringify({ code: "ATTENDANCE_AUDIT_DEFERRED", error: audit.error.message }));
  return { success: true, action, updatedRows, groups: items.length };
}

async function superAdminAuditV3(body: Record<string, unknown>, auth: AuthenticatedUser) {
  requireSuperAdminRole(auth);
  const limit = clampInt(body.limit, 100, 1, 500);
  const logs = await db.from("Audit_Log").select("*").order("Waktu", { ascending: false }).limit(limit);
  if (logs.error) throw logs.error;
  const actorIds = [...new Set((logs.data || []).map((row: any) => String(row.ID_User_Pelaku || "")).filter((id) => id && id !== "SYSTEM"))];
  const users = actorIds.length
    ? await db.from("Users").select("ID_User,Nama_Lengkap,Email,Role,SPPG").in("ID_User", actorIds)
    : { data: [], error: null };
  if (users.error) throw users.error;
  const userMap = new Map((users.data || []).map((row: any) => [String(row.ID_User), row]));
  return {
    logs: (logs.data || []).map((row: any) => {
      const actor: any = userMap.get(String(row.ID_User_Pelaku || ""));
      const system = String(row.ID_User_Pelaku || "") === "SYSTEM";
      return {
        ...row,
        _pelakuNama: actor?.Nama_Lengkap || (system ? "Sistem" : row.ID_User_Pelaku || "Tidak diketahui"),
        _pelakuEmail: actor?.Email || "",
        _pelakuRole: actor?.Role || (system ? "SYSTEM" : ""),
        _pelakuSppg: actor?.SPPG || "",
      };
    }),
  };
}

async function route(action: string, body: Record<string, unknown>, auth: AuthenticatedUser) {
  if (action === "getOperationalUsersV2") return await operationalUsers(body, auth);
  if (action === "getOperationalDashboardV2") return await operationalDashboard(auth);
  if (action === "getAbsensiGroupedDataV2") return await groupedAttendanceV2(body, auth);
  if (action === "validateAttendanceBulkV3") return await validateAttendanceBulkV3(body, auth);
  if (action === "getSuperAdminAuditV3") return await superAdminAuditV3(body, auth);
  if (action === "listFeatureFlags") {
    requireOperationalRole(auth);
    const result = await db.from("Release_Feature_Flags").select("*").order("Flag_Key");
    if (result.error) throw result.error;
    return result.data || [];
  }
  if (action === "setFeatureFlag") {
    requireSuperAdminRole(auth);
    const result = await db.from("Release_Feature_Flags").upsert({
      Flag_Key: requiredString(body.key, "key", { max: 100 }),
      Enabled: requiredBoolean(body.enabled, "enabled"),
      Scope_SPPG: optionalString(body.scopeSppg, 200),
      Config: plainObject(body.config, "config"),
      Updated_By: auth.idUser,
      Updated_At: new Date().toISOString(),
    }).select().maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }
  if (action === "transitionPayroll") {
    requireOperationalRole(auth);
    const result = await db.rpc("transition_payroll_workflow", {
      p_slip_id: requiredString(body.slipId, "slipId", { max: 200 }),
      p_user_id: requiredString(body.userId, "userId", { max: 100 }),
      p_to_status: workflowStatus(body.toStatus, "toStatus"),
      p_actor_id: auth.idUser,
      p_reason: optionalString(body.reason, 2000),
      p_idempotency_key: optionalString(body.idempotencyKey, 200),
    });
    if (result.error) throw result.error;
    return result.data;
  }
  if (action === "listPayrollWorkflow") {
    requireOperationalRole(auth);
    let query = db.from("Payroll_Workflow_State").select("*").order("Updated_At", { ascending: false }).limit(200);
    if (body.status !== undefined && body.status !== null && String(body.status).trim() !== "") {
      query = query.eq("Status", workflowStatus(body.status, "status"));
    }
    const result = await query;
    if (result.error) throw result.error;
    return result.data || [];
  }
  if (action === "logComplaintIdentityAccess") {
    requireSuperAdminRole(auth);
    const result = await db.rpc("log_complaint_identity_access", {
      p_complaint_id: requiredString(body.complaintId, "complaintId", { max: 200 }),
      p_actor_id: auth.idUser,
      p_actor_role: auth.role,
      p_reason: requiredString(body.reason, "reason", { min: 10, max: 2000 }),
      p_request_id: optionalString(body.requestId, 200),
    });
    if (result.error) throw result.error;
    return { accessId: result.data };
  }
  if (action === "listComplaintPrivacyLog") {
    requireSuperAdminRole(auth);
    const result = await db.from("Complaint_Privacy_Access_Log").select("*").order("Created_At", { ascending: false }).limit(300);
    if (result.error) throw result.error;
    return result.data || [];
  }
  if (action === "listUserAccess") {
    requireOperationalRole(auth);
    let query = db.from("User_SPPG_Access_V2").select("*").order("Created_At", { ascending: false }).limit(500);
    if (body.userId !== undefined && body.userId !== null && String(body.userId).trim() !== "") {
      query = query.eq("ID_User", requiredString(body.userId, "userId", { max: 100 }));
    }
    const result = await query;
    if (result.error) throw result.error;
    return result.data || [];
  }
  if (action === "grantUserAccess") {
    requireSuperAdminRole(auth);
    const result = await db.from("User_SPPG_Access_V2").upsert({
      ID_User: requiredString(body.userId, "userId", { max: 100 }),
      SPPG: requiredString(body.sppg, "sppg", { max: 200 }),
      Role_Scope: optionalString(body.roleScope, 100),
      Active: true,
      Valid_Until: optionalIsoDateTime(body.validUntil, "validUntil"),
      Granted_By: auth.idUser,
    }, { onConflict: "ID_User,SPPG,Role_Scope" }).select().maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }
  if (action === "recordUserSecurityEvent") {
    requireOperationalRole(auth);
    const result = await db.from("User_Security_Events").insert({
      ID_User: requiredString(body.userId, "userId", { max: 100 }),
      Event_Type: requiredString(body.eventType, "eventType", { max: 100 }),
      Actor_ID: auth.idUser,
      Session_ID: optionalString(body.sessionId, 200),
      Device_ID: optionalString(body.deviceId, 200),
      Before_Data: plainObject(body.beforeData, "beforeData"),
      After_Data: plainObject(body.afterData, "afterData"),
      Reason: optionalString(body.reason, 2000),
    }).select().maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }
  throw new ValidationError("ACTION_NOT_SUPPORTED", "Action tidak didukung.", "action");
}

Deno.serve(async (req) => {
  const requestId = createRequestId();
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin, corsOptions);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: origin && isOriginAllowed(origin, corsOptions) ? 204 : 403, headers });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId }, 405, requestId, headers);
  }
  try {
    const body = await req.json();
    const auth = await authenticateUserSession(db, body.token);
    const result = await route(String(body.action || ""), body, auth);
    return jsonResponse({ success: true, result, requestId }, 200, requestId, headers);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Terjadi kesalahan pada server.";
    if (error instanceof ValidationError) {
      status = 422; code = error.code; message = error.message;
    } else if (rawMessage === "SESSION_EXPIRED") {
      status = 401; code = rawMessage; message = "Sesi telah berakhir.";
    } else if (rawMessage === "ACCOUNT_INACTIVE" || rawMessage === "FORBIDDEN") {
      status = 403; code = rawMessage; message = "Akses ditolak.";
    } else if (rawMessage === "ATTENDANCE_RESULT_TOO_LARGE") {
      status = 422; code = rawMessage; message = "Data absensi terlalu besar. Gunakan filter pencarian agar hasil lebih spesifik.";
    } else if (rawMessage.includes("FINAL_STATE") || rawMessage.includes("IDEMPOTENCY")) {
      status = 409; code = rawMessage; message = "Status workflow tidak dapat diubah.";
    }
    console.error(JSON.stringify({ requestId, code, error: rawMessage }));
    return jsonResponse({ success: false, code, message, requestId }, status, requestId, headers);
  }
});
