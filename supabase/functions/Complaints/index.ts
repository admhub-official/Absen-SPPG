import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  type AuthenticatedUser,
  authenticateUserSession,
  requireOperationalRole,
} from "../_shared/auth.ts";
import { corsHeaders, createRequestId, isOriginAllowed, jsonResponse } from "../_shared/http.ts";
import { normalizeRole } from "../_shared/contracts.ts";
import { optionalString, requiredString, ValidationError } from "../_shared/validation.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS_OPTIONS = {
  allowedOriginsEnv: Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "",
  productionOrigin: "https://hadirly.org",
  previewSuffix: ".pages.dev",
  localOrigins: [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ],
};

const CATEGORIES = new Set([
  "Absensi",
  "Payroll / Gaji",
  "Akun dan Profil",
  "Fasilitas Kerja",
  "Etika / Perilaku",
  "Keamanan",
  "Lainnya",
]);
const TICKET_STATUSES = new Set(["BARU", "DIPROSES", "MENUNGGU_USER", "SELESAI"]);
const PRIORITIES = new Set(["RENDAH", "NORMAL", "TINGGI", "MENDESAK"]);

type DataRow = Record<string, any>;
type ActorProfile = {
  ID_User: string;
  Role: string | null;
  Nama_Lengkap: string | null;
  ID_Card_Unik: string | null;
  Email: string | null;
  SPPG: string | null;
  Yayasan: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function generateComplaintId(idempotencyKey: unknown): string {
  const key = optionalString(idempotencyKey, 120)?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
  if (key) return `PGD_${key}`;
  return `PGD_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

async function actorProfile(auth: AuthenticatedUser): Promise<ActorProfile> {
  const result = await db
    .from("Users")
    .select("ID_User,Role,Nama_Lengkap,ID_Card_Unik,Email,SPPG,Yayasan")
    .eq("ID_User", auth.idUser)
    .maybeSingle();
  if (result.error || !result.data) throw new Error("ACCOUNT_INACTIVE");
  return result.data as ActorProfile;
}

async function accessibleSppgs(auth: AuthenticatedUser): Promise<string[] | null> {
  if (normalizeRole(auth.role) === "SUPER ADMIN") return null;
  const actor = await actorProfile(auth);
  const scopes = new Set<string>();
  if (actor.SPPG) scopes.add(String(actor.SPPG));
  if (actor.Email) {
    const access = await db
      .from("Akses_Email")
      .select("SPPG")
      .ilike("Email", String(actor.Email))
      .eq("Aktif", true);
    if (access.error) throw access.error;
    for (const row of access.data || []) {
      if (row.SPPG) scopes.add(String(row.SPPG));
    }
  }
  return [...scopes];
}

async function listScopedComplaints(auth: AuthenticatedUser): Promise<DataRow[]> {
  const scopes = await accessibleSppgs(auth);
  if (scopes && scopes.length === 0) return [];
  let query = db.from("Pengaduan").select("*").order("Timestamp", { ascending: false }).limit(1000);
  if (scopes) query = query.in("SPPG", scopes);
  const result = await query;
  if (result.error) throw result.error;
  return (result.data || []) as DataRow[];
}

async function scopedComplaint(auth: AuthenticatedUser, idPengaduan: string): Promise<DataRow> {
  const result = await db
    .from("Pengaduan")
    .select("*")
    .eq("ID_Pengaduan", idPengaduan)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("NOT_FOUND");
  if (normalizeRole(auth.role) === "SUPER ADMIN") return result.data as DataRow;
  const scopes = await accessibleSppgs(auth);
  if (!scopes?.includes(String(result.data.SPPG || ""))) throw new Error("FORBIDDEN");
  return result.data as DataRow;
}

function redactComplaint(row: DataRow, auth: AuthenticatedUser): DataRow {
  const anonymous = String(row.Jenis_Pengirim || "").toUpperCase() === "ANONYMOUS";
  if (!anonymous || normalizeRole(auth.role) === "SUPER ADMIN") return row;
  return {
    ...row,
    User: null,
    User_Pengirim: "Anonymous",
  };
}

async function auditBestEffort(
  activity: string,
  actorId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await db.from("Audit_Log").insert({
      ID_Log: `AUD_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      Waktu: nowIso(),
      ID_User_Pelaku: actorId,
      Jenis_Aktivitas: activity,
      Detail: detail,
    });
    if (result.error) throw result.error;
  } catch (error) {
    console.error(JSON.stringify({
      code: "COMPLAINT_AUDIT_DEFERRED",
      activity,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function sendComplaint(payload: Record<string, unknown>, auth: AuthenticatedUser) {
  const category = requiredString(payload.Kategori, "Kategori", { min: 1, max: 100 });
  const message = requiredString(payload.Isi_Pengaduan, "Isi_Pengaduan", { min: 10, max: 5000 });
  if (!CATEGORIES.has(category)) {
    throw new ValidationError("INVALID_CATEGORY", "Kategori pengaduan tidak valid.", "Kategori");
  }

  const anonymous = String(payload.Jenis_Pengirim || "").trim().toUpperCase() === "ANONYMOUS";
  const actor = await actorProfile(auth);
  const idPengaduan = generateComplaintId(payload.idempotencyKey);
  const timestamp = nowIso();
  const sender = anonymous
    ? "Anonymous"
    : `${actor.Nama_Lengkap || ""} (${actor.ID_Card_Unik || ""})`.trim();

  const insert = await db.from("Pengaduan").insert({
    ID_Pengaduan: idPengaduan,
    Timestamp: timestamp,
    Kategori: category,
    Isi_Pengaduan: message,
    Jenis_Pengirim: anonymous ? "Anonymous" : "Terdaftar",
    User_Pengirim: sender || auth.idUser,
    User: auth.idUser,
    Status_Baca: "Belum Dibaca",
    Ditandai_Oleh: null,
    Waktu_Dibaca: null,
    Tanggapan_Admin: null,
    SPPG: actor.SPPG,
    Yayasan: actor.Yayasan,
    Ditanggapi_Oleh: null,
    Waktu_Tanggapan: null,
    Status_Tiket: "BARU",
    Prioritas: "NORMAL",
    Waktu_Status_At: timestamp,
    Selesai_At: null,
  });

  if (insert.error) {
    if (insert.error.code === "23505") {
      const existing = await db
        .from("Pengaduan")
        .select("ID_Pengaduan,User")
        .eq("ID_Pengaduan", idPengaduan)
        .maybeSingle();
      if (!existing.error && existing.data?.User === auth.idUser) {
        return { success: true, idPengaduan, duplicateSafe: true };
      }
    }
    throw insert.error;
  }

  await auditBestEffort(
    "KIRIM_PENGADUAN",
    auth.idUser,
    { idPengaduan, kategori: category, jenisPengirim: anonymous ? "Anonymous" : "Terdaftar" },
  );
  return { success: true, idPengaduan };
}

async function myComplaints(auth: AuthenticatedUser) {
  const result = await db
    .from("Pengaduan")
    .select("*")
    .eq("User", auth.idUser)
    .order("Timestamp", { ascending: false })
    .limit(500);
  if (result.error) throw result.error;
  return { success: true, pengaduan: result.data || [] };
}

async function adminNotifications(auth: AuthenticatedUser) {
  requireOperationalRole(auth);
  const rows = await listScopedComplaints(auth);
  const jumlah = rows.filter((row) => String(row.Status_Baca) === "Belum Dibaca").length;
  return { success: true, jumlah };
}

async function adminComplaints(payload: Record<string, unknown>, auth: AuthenticatedUser) {
  requireOperationalRole(auth);
  let rows = await listScopedComplaints(auth);
  const filters = payload.filters && typeof payload.filters === "object"
    ? payload.filters as Record<string, unknown>
    : {};
  const status = optionalString(filters.status, 50);
  const category = optionalString(filters.kategori, 100);
  if (status) {
    const normalized = status.toUpperCase();
    rows = rows.filter((row) =>
      String(row.Status_Tiket || "").toUpperCase() === normalized ||
      String(row.Status_Baca || "").toUpperCase() === normalized
    );
  }
  if (category) rows = rows.filter((row) => String(row.Kategori || "") === category);
  return { success: true, pengaduan: rows.map((row) => redactComplaint(row, auth)) };
}

async function markRead(payload: Record<string, unknown>, auth: AuthenticatedUser) {
  requireOperationalRole(auth);
  const id = requiredString(payload.idPengaduan, "idPengaduan", { max: 160 });
  const row = await scopedComplaint(auth, id);
  if (String(row.Status_Baca) === "Sudah Dibaca") {
    return { success: true, message: "Pengaduan sudah ditandai dibaca sebelumnya." };
  }
  const timestamp = nowIso();
  const patch: DataRow = {
    Status_Baca: "Sudah Dibaca",
    Ditandai_Oleh: auth.idUser,
    Waktu_Dibaca: timestamp,
  };
  if (String(row.Status_Tiket || "BARU").toUpperCase() === "BARU") {
    patch.Status_Tiket = "DIPROSES";
    patch.Waktu_Status_At = timestamp;
  }
  const update = await db.from("Pengaduan").update(patch).eq("ID_Pengaduan", id);
  if (update.error) throw update.error;
  await auditBestEffort("TANDAI_PENGADUAN_DIBACA", auth.idUser, { idPengaduan: id });
  return { success: true, message: "Pengaduan berhasil ditandai sudah dibaca." };
}

async function replyComplaint(payload: Record<string, unknown>, auth: AuthenticatedUser) {
  requireOperationalRole(auth);
  const id = requiredString(payload.idPengaduan, "idPengaduan", { max: 160 });
  const response = requiredString(payload.tanggapan, "tanggapan", { min: 1, max: 5000 });
  await scopedComplaint(auth, id);
  const timestamp = nowIso();
  const update = await db.from("Pengaduan").update({
    Tanggapan_Admin: response,
    Ditanggapi_Oleh: auth.idUser,
    Waktu_Tanggapan: timestamp,
    Status_Baca: "Sudah Dibaca",
    Ditandai_Oleh: auth.idUser,
    Waktu_Dibaca: timestamp,
    Status_Tiket: "MENUNGGU_USER",
    Waktu_Status_At: timestamp,
    Selesai_At: null,
  }).eq("ID_Pengaduan", id);
  if (update.error) throw update.error;
  await auditBestEffort("TANGGAPI_PENGADUAN", auth.idUser, { idPengaduan: id });
  return { success: true, message: "Tanggapan admin berhasil disimpan." };
}

async function updateTicket(payload: Record<string, unknown>, auth: AuthenticatedUser) {
  requireOperationalRole(auth);
  const id = requiredString(payload.idPengaduan, "idPengaduan", { max: 160 });
  const status = requiredString(payload.status, "status", { max: 50 }).toUpperCase();
  const priority = String(payload.prioritas || "NORMAL").trim().toUpperCase();
  if (!TICKET_STATUSES.has(status)) {
    throw new ValidationError("INVALID_STATUS", "Status tiket tidak valid.", "status");
  }
  if (!PRIORITIES.has(priority)) {
    throw new ValidationError("INVALID_PRIORITY", "Prioritas tiket tidak valid.", "prioritas");
  }
  await scopedComplaint(auth, id);
  const timestamp = nowIso();
  const update = await db.from("Pengaduan").update({
    Status_Tiket: status,
    Prioritas: priority,
    Waktu_Status_At: timestamp,
    Selesai_At: status === "SELESAI" ? timestamp : null,
  }).eq("ID_Pengaduan", id);
  if (update.error) throw update.error;
  await auditBestEffort("UPDATE_STATUS_PENGADUAN", auth.idUser, {
    idPengaduan: id,
    status,
    prioritas: priority,
  });
  return { success: true, message: "Status tiket berhasil diperbarui." };
}

async function closeOwnTicket(payload: Record<string, unknown>, auth: AuthenticatedUser) {
  const id = requiredString(payload.idPengaduan, "idPengaduan", { max: 160 });
  const complaint = await db
    .from("Pengaduan")
    .select("ID_Pengaduan,User,Status_Tiket")
    .eq("ID_Pengaduan", id)
    .maybeSingle();
  if (complaint.error) throw complaint.error;
  if (!complaint.data) throw new Error("NOT_FOUND");
  if (complaint.data.User !== auth.idUser) throw new Error("FORBIDDEN");
  if (String(complaint.data.Status_Tiket).toUpperCase() === "SELESAI") {
    return { success: true, message: "Tiket sudah selesai." };
  }
  const timestamp = nowIso();
  const update = await db.from("Pengaduan").update({
    Status_Tiket: "SELESAI",
    Waktu_Status_At: timestamp,
    Selesai_At: timestamp,
  }).eq("ID_Pengaduan", id).eq("User", auth.idUser);
  if (update.error) throw update.error;
  await auditBestEffort("SELESAIKAN_PENGADUAN_USER", auth.idUser, { idPengaduan: id });
  return { success: true, message: "Tiket berhasil ditandai selesai." };
}

async function route(
  functionName: string,
  payload: Record<string, unknown>,
  auth: AuthenticatedUser,
) {
  switch (functionName) {
    case "kirimPengaduan":
      return await sendComplaint(payload, auth);
    case "getRiwayatPengaduanSaya":
      return await myComplaints(auth);
    case "getNotifikasiAdmin":
      return await adminNotifications(auth);
    case "getDaftarPengaduan":
      return await adminComplaints(payload, auth);
    case "tandaiSudahDibaca":
      return await markRead(payload, auth);
    case "simpanTanggapanAdmin":
      return await replyComplaint(payload, auth);
    case "updateComplaintTicketV2":
      return await updateTicket(payload, auth);
    case "closeMyComplaintTicketV2":
      return await closeOwnTicket(payload, auth);
    default:
      throw new ValidationError("ACTION_NOT_SUPPORTED", "Fungsi pengaduan tidak didukung.", "function");
  }
}

Deno.serve(async (request) => {
  const requestId = createRequestId("CMP");
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin, CORS_OPTIONS);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: origin && isOriginAllowed(origin, CORS_OPTIONS) ? 204 : 403,
      headers,
    });
  }
  if (request.method !== "POST") {
    return jsonResponse(
      { success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId },
      405,
      requestId,
      headers,
    );
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const payload = body.data && typeof body.data === "object"
      ? body.data as Record<string, unknown>
      : body;
    const functionName = String(body.function || body.functionName || body.action || "");
    const auth = await authenticateUserSession(db, payload.token || body.token);
    const result = await route(functionName, payload, auth);
    return jsonResponse({ success: true, result, requestId }, 200, requestId, headers);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Workflow pengaduan gagal diproses.";

    if (error instanceof ValidationError) {
      status = 422;
      code = error.code;
      message = error.message;
    } else if (rawMessage === "SESSION_EXPIRED") {
      status = 401;
      code = rawMessage;
      message = "Sesi telah berakhir. Silakan login kembali.";
    } else if (rawMessage === "ACCOUNT_INACTIVE" || rawMessage === "FORBIDDEN") {
      status = 403;
      code = rawMessage;
      message = "Akses pengaduan ditolak.";
    } else if (rawMessage === "NOT_FOUND") {
      status = 404;
      code = rawMessage;
      message = "Pengaduan tidak ditemukan.";
    }

    console.error(JSON.stringify({ requestId, code, error: rawMessage }));
    return jsonResponse({ success: false, code, message, requestId }, status, requestId, headers);
  }
});
