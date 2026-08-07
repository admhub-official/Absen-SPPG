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
  "ID_User",
  "Username",
  "Role",
  "Status_Aktif",
  "Nama_Lengkap",
  "Tempat_Lahir",
  "Tanggal_Lahir",
  "Jenis_Kelamin",
  "Email",
  "No_Whatsapp",
  "SPPG",
  "Yayasan",
  "Tanggal_Mulai_Kerja",
  "Jabatan_Divisi",
  "Gaji_Harian",
  "Nama_Bank",
  "Atas_Nama_Rekening",
  "Nomor_Rekening",
  "ID_Card_Unik",
  "URL_Foto_Profil",
  "URL_Foto_Profil_Asli",
  "URL_Foto_Wajah_Ref",
  "Setuju_Kebijakan_Data",
  "Created_At",
  "Updated_At",
  "Akun_Dibekukan",
  "NIK",
  "Alamat",
].join(",");

const normalize = (value: unknown) => String(value ?? "").trim().toUpperCase().replace(/_/g, " ");
const activeValue = (value: unknown) =>
  value === true || value === 1 || ["TRUE", "1", "ACTIVE", "AKTIF"].includes(normalize(value));
const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const jakartaDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

async function actorProfile(auth: AuthenticatedUser) {
  const result = await db
    .from("Users")
    .select("ID_User,Email,SPPG,Role")
    .eq("ID_User", auth.idUser)
    .maybeSingle();
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
  return (result.data || []) as Record<string, unknown>[];
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

function profileScore(row: Record<string, unknown>): number {
  return Math.round((10 - profileMissing(row).length) * 10);
}

async function presenceFor(ids: string[]) {
  const latest = new Map<string, string>();
  const online = new Set<string>();
  if (!ids.length) return { latest, online };

  const sessionTable = db.from("Sessions");
  const sessions = await sessionTable
    .select("ID_User,Expires_At,Last_Activity_At,Created_At")
    .in("ID_User", ids)
    .gt("Expires_At", new Date().toISOString());
  if (sessions.error) throw sessions.error;

  const onlineCutoff = Date.now() - 2 * 60 * 1000;
  for (const row of sessions.data || []) {
    const id = String(row.ID_User || "");
    if (!id) continue;
    const activity = String(row.Last_Activity_At || row.Created_At || "");
    if (activity) {
      const previous = latest.get(id);
      if (!previous || new Date(activity).getTime() > new Date(previous).getTime()) latest.set(id, activity);
      if (new Date(activity).getTime() >= onlineCutoff) online.add(id);
    }
  }
  return { latest, online };
}

async function todayPunches(ids: string[]) {
  const punches = new Map<string, Record<string, unknown>[]>();
  if (!ids.length) return punches;
  const attendance = await db
    .from("Absensi")
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

function hasArrival(rows: Record<string, unknown>[]) {
  return rows.some((row) => ["DATANG", "MASUK", "IN"].includes(normalize(row.Jenis_Absen)));
}

function hasDeparture(rows: Record<string, unknown>[]) {
  return rows.some((row) => ["PULANG", "KELUAR", "OUT"].includes(normalize(row.Jenis_Absen)));
}

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

  let filtered = allUsers.filter((row) => {
    if (search) {
      const haystack = [row.Nama_Lengkap, row.Email, row.Username, row.SPPG, row.Jabatan_Divisi]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
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
    const arrived = hasArrival(today);
    const departed = hasDeparture(today);
    if (!arrived) belumDatang.push(summary);
    else if (!departed) belumPulang.push(summary);

    const missing = profileMissing(row);
    if (missing.length) profilBelumLengkap.push({ ...summary, missing, score: profileScore(row) });
  }

  let complaintQuery = db.from("Pengaduan").select("ID_Pengaduan,SPPG,Status_Tiket").limit(5000);
  let slipQuery = db
    .from("Slip_Gaji")
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
    exceptions: {
      belumDatang,
      belumPulang,
      profilBelumLengkap,
    },
  };
}

async function route(action: string, body: Record<string, unknown>, auth: AuthenticatedUser) {
  if (action === "getOperationalUsersV2") return await operationalUsers(body, auth);
  if (action === "getOperationalDashboardV2") return await operationalDashboard(auth);

  if (action === "listFeatureFlags") {
    requireOperationalRole(auth);
    const result = await db.from("Release_Feature_Flags").select("*").order("Flag_Key");
    if (result.error) throw result.error;
    return result.data || [];
  }

  if (action === "setFeatureFlag") {
    requireSuperAdminRole(auth);
    const key = requiredString(body.key, "key", { max: 100 });
    const enabled = Boolean(body.enabled);
    const scope = optionalString(body.scopeSppg, 200);
    const config = typeof body.config === "object" && body.config ? body.config : {};
    const result = await db
      .from("Release_Feature_Flags")
      .upsert({
        Flag_Key: key,
        Enabled: enabled,
        Scope_SPPG: scope,
        Config: config,
        Updated_By: auth.idUser,
        Updated_At: new Date().toISOString(),
      })
      .select()
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  if (action === "transitionPayroll") {
    requireOperationalRole(auth);
    const result = await db.rpc("transition_payroll_workflow", {
      p_slip_id: requiredString(body.slipId, "slipId", { max: 200 }),
      p_user_id: requiredString(body.userId, "userId", { max: 100 }),
      p_to_status: requiredString(body.toStatus, "toStatus", { max: 50 }).toUpperCase(),
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
    if (body.status) query = query.eq("Status", String(body.status).toUpperCase());
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
    const result = await db
      .from("Complaint_Privacy_Access_Log")
      .select("*")
      .order("Created_At", { ascending: false })
      .limit(300);
    if (result.error) throw result.error;
    return result.data || [];
  }

  if (action === "listUserAccess") {
    requireOperationalRole(auth);
    let query = db
      .from("User_SPPG_Access_V2")
      .select("*")
      .order("Created_At", { ascending: false })
      .limit(500);
    if (body.userId) query = query.eq("ID_User", String(body.userId));
    const result = await query;
    if (result.error) throw result.error;
    return result.data || [];
  }

  if (action === "grantUserAccess") {
    requireSuperAdminRole(auth);
    const row = {
      ID_User: requiredString(body.userId, "userId", { max: 100 }),
      SPPG: requiredString(body.sppg, "sppg", { max: 200 }),
      Role_Scope: optionalString(body.roleScope, 100),
      Active: true,
      Valid_Until: body.validUntil || null,
      Granted_By: auth.idUser,
    };
    const result = await db
      .from("User_SPPG_Access_V2")
      .upsert(row, { onConflict: "ID_User,SPPG,Role_Scope" })
      .select()
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  if (action === "recordUserSecurityEvent") {
    requireOperationalRole(auth);
    const result = await db
      .from("User_Security_Events")
      .insert({
        ID_User: requiredString(body.userId, "userId", { max: 100 }),
        Event_Type: requiredString(body.eventType, "eventType", { max: 100 }),
        Actor_ID: auth.idUser,
        Session_ID: optionalString(body.sessionId, 200),
        Device_ID: optionalString(body.deviceId, 200),
        Before_Data: body.beforeData || {},
        After_Data: body.afterData || {},
        Reason: optionalString(body.reason, 2000),
      })
      .select()
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  throw new ValidationError("ACTION_NOT_SUPPORTED", "action");
}

Deno.serve(async (req) => {
  const requestId = createRequestId();
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin, corsOptions);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: origin && isOriginAllowed(origin, corsOptions) ? 204 : 403,
      headers,
    });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId },
      405,
      requestId,
      headers,
    );
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
      status = 422;
      code = error.code;
      message = error.message;
    } else if (rawMessage === "SESSION_EXPIRED") {
      status = 401;
      code = rawMessage;
      message = "Sesi telah berakhir.";
    } else if (rawMessage === "ACCOUNT_INACTIVE" || rawMessage === "FORBIDDEN") {
      status = 403;
      code = rawMessage;
      message = "Akses ditolak.";
    } else if (rawMessage.includes("FINAL_STATE") || rawMessage.includes("IDEMPOTENCY")) {
      status = 409;
      code = rawMessage;
      message = "Status workflow tidak dapat diubah.";
    }

    console.error(JSON.stringify({ requestId, code, error: rawMessage }));
    return jsonResponse({ success: false, code, message, requestId }, status, requestId, headers);
  }
});
