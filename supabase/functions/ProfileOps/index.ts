import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(body), { status, headers: { ...CORS, ...(requestId ? { "X-Request-Id": requestId } : {}) } });
const clean = (value: unknown, max = 180) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const active = (value: unknown) => value === true || value === 1 || ["TRUE", "1"].includes(String(value || "").toUpperCase());
const SELF_PROTECTED_FIELDS = [
  "Gaji_Harian",
  "Role",
  "Status_Aktif",
  "SPPG",
  "Yayasan",
  "Jabatan_Divisi",
  "Tanggal_Mulai_Kerja",
] as const;

type SessionUser = { ID_User: string; Role: string | null; Status_Aktif: boolean | string | number | null };

async function authenticate(tokenValue: unknown): Promise<SessionUser> {
  const token = clean(tokenValue, 500);
  if (!token) throw new Error("SESSION_EXPIRED");
  const session = await db.from("Sessions").select("ID_User,Type,Expires_At").eq("Token", token).maybeSingle();
  if (session.error) throw new Error("SESSION_QUERY_FAILED");
  if (!session.data?.ID_User || String(session.data.Type || "").toLowerCase() !== "user" || new Date(session.data.Expires_At).getTime() <= Date.now()) throw new Error("SESSION_EXPIRED");
  const user = await db.from("Users").select("ID_User,Role,Status_Aktif").eq("ID_User", session.data.ID_User).maybeSingle();
  if (user.error) throw new Error("ACCOUNT_QUERY_FAILED");
  if (!user.data || !active(user.data.Status_Aktif)) throw new Error("ACCOUNT_INACTIVE");
  return user.data as SessionUser;
}

function dateOnly(value: unknown): string | null {
  const raw = clean(value, 32);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Tanggal tidak valid.");
  const date = new Date(`${raw}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) throw new Error("Tanggal tidak valid.");
  return raw;
}

// Kept as an explicit compatibility contract for employment/profile workflows.
// Self-service profile updates no longer call this because SPPG/Yayasan are protected fields.
async function resolveFoundation(sppg: string, requestedFoundation: string): Promise<string> {
  if (!sppg) return requestedFoundation;
  const master = await db.from("Master_SPPG").select("Nama_SPPG,Yayasan,Aktif").ilike("Nama_SPPG", sppg).limit(1).maybeSingle();
  if (master.error) {
    console.warn(JSON.stringify({ code: "PROFILE_MASTER_SPPG_LOOKUP_DEFERRED", sppg, error: master.error.message }));
    return requestedFoundation;
  }
  if (master.data && active(master.data.Aktif)) return clean(master.data.Yayasan, 180) || requestedFoundation;
  return requestedFoundation;
}

async function getProfile(user: SessionUser) {
  const result = await db.from("Users").select("ID_User,Nama_Lengkap,NIK,Tempat_Lahir,Tanggal_Lahir,Jenis_Kelamin,Alamat,Email,No_Whatsapp,SPPG,Yayasan,Jabatan_Divisi,Tanggal_Mulai_Kerja,Gaji_Harian,Nama_Bank,Nomor_Rekening,Atas_Nama_Rekening").eq("ID_User", user.ID_User).maybeSingle();
  if (result.error) throw new Error(`PROFILE_QUERY_FAILED:${result.error.message}`);
  if (!result.data) throw new Error("PROFILE_NOT_FOUND");
  return result.data;
}

async function updateProfile(user: SessionUser, updatesValue: unknown) {
  if (!updatesValue || typeof updatesValue !== "object" || Array.isArray(updatesValue)) throw new Error("Updates profil wajib berupa object.");
  const updates = updatesValue as Record<string, unknown>;

  // Explicit guards are intentionally retained because these are long-standing
  // security contracts consumed by employment and digital-identity workflows.
  if (Object.prototype.hasOwnProperty.call(updates, "Gaji_Harian")) {
    throw new Error("Gaji Harian hanya dapat diubah oleh ADMIN/SUPER ADMIN melalui manajemen user.");
  }
  if (
    Object.prototype.hasOwnProperty.call(updates, "Role") ||
    Object.prototype.hasOwnProperty.call(updates, "Status_Aktif")
  ) {
    throw new Error("Role dan status akun tidak dapat diubah dari Profil.");
  }

  const protectedFields = SELF_PROTECTED_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(updates, field));
  if (protectedFields.length) {
    throw new Error(`Field kepegawaian tidak dapat diubah dari Profil: ${protectedFields.join(", ")}. Gunakan manajemen user dengan otorisasi yang sesuai.`);
  }

  const payload: Record<string, unknown> = {};
  const stringFields: Array<[string, number]> = [
    ["Nama_Lengkap",180],["NIK",32],["Tempat_Lahir",120],["Jenis_Kelamin",40],["Alamat",1200],["Email",254],["No_Whatsapp",40],
    ["Nama_Bank",120],["Nomor_Rekening",80],["Atas_Nama_Rekening",180],
  ];
  for (const [field,max] of stringFields) if (updates[field] !== undefined) payload[field] = clean(updates[field], max);
  if (updates.Tanggal_Lahir !== undefined) payload.Tanggal_Lahir = dateOnly(updates.Tanggal_Lahir);
  if (!Object.keys(payload).length) throw new Error("Tidak ada field profil yang dapat diperbarui.");
  if (!clean(payload.Nama_Lengkap ?? updates.Nama_Lengkap,180) && updates.Nama_Lengkap !== undefined) throw new Error("Nama lengkap tidak boleh kosong.");
  if (payload.NIK && !/^\d{16}$/.test(String(payload.NIK))) throw new Error("NIK harus terdiri dari 16 digit angka.");
  if (payload.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.Email))) throw new Error("Format email tidak valid.");

  payload.Updated_At = new Date().toISOString();
  const result = await db.from("Users").update(payload).eq("ID_User", user.ID_User);
  if (result.error) throw new Error(`Gagal memperbarui profil: ${result.error.message}`);
  try {
    const audit = await db.from("Audit_Log").insert({
      ID_Log:`AUD_${Date.now()}_${crypto.randomUUID().slice(0,8)}`,
      Waktu:new Date().toISOString(),
      ID_User_Pelaku:user.ID_User,
      Jenis_Aktivitas:"UPDATE_PROFIL",
      Detail:{
        idUser:user.ID_User,
        fields:Object.keys(payload).filter((field)=>field!=="Updated_At"),
        protectedFields:[...SELF_PROTECTED_FIELDS],
      },
    });
    if (audit.error) throw audit.error;
  } catch (error) { console.warn("Profile audit deferred", error); }
  return { message:"Profil berhasil diperbarui.", profile:await getProfile(user) };
}

function mapError(raw: string) {
  if (raw === "SESSION_EXPIRED") return { status: 401, code: raw, message: "Sesi telah berakhir. Silakan login kembali." };
  if (raw === "ACCOUNT_INACTIVE") return { status: 403, code: raw, message: "Akun tidak aktif atau tidak ditemukan." };
  if (raw === "PROFILE_NOT_FOUND") return { status: 404, code: raw, message: "Profil tidak ditemukan." };
  if (/tidak valid|tidak boleh|tidak dapat diubah|hanya dapat|Format|Tanggal|NIK|wajib berupa object|Tidak ada field/i.test(raw)) return { status: 422, code: "VALIDATION_ERROR", message: raw };
  return { status: 500, code: "INTERNAL_ERROR", message: "Gagal memperbarui profil." };
}

Deno.serve(async (request) => {
  const requestId = `PRO_${Date.now()}_${crypto.randomUUID().slice(0,8)}`;
  if (request.method === "OPTIONS") return new Response("ok", { headers:CORS });
  if (request.method !== "POST") return json({success:false,code:"METHOD_NOT_ALLOWED",message:"Method tidak didukung.",error:"Method tidak didukung.",requestId},405,requestId);

  let body: Record<string,unknown>;
  try {
    body = await request.json() as Record<string,unknown>;
  } catch {
    return json({success:false,code:"INVALID_JSON",message:"Body JSON tidak valid.",error:"Body JSON tidak valid.",requestId},400,requestId);
  }

  try {
    const action = clean(body.action || body.function,80) || "updateProfil";
    const user = await authenticate(body.token);
    const result = action === "updateProfil" ? await updateProfile(user,body.updates) : action === "getProfileEmployment" ? await getProfile(user) : null;
    if (!result) return json({success:false,code:"ACTION_NOT_SUPPORTED",message:"Aksi profil tidak didukung.",error:"Aksi profil tidak didukung.",requestId},422,requestId);
    return json({success:true,result,requestId},200,requestId);
  } catch(error) {
    const raw=error instanceof Error?error.message:String(error);
    const mapped=mapError(raw);
    console.error(JSON.stringify({requestId,code:mapped.code,status:mapped.status,error:raw}));
    return json({success:false,code:mapped.code,message:mapped.message,error:mapped.message,requestId},mapped.status,requestId);
  }
});