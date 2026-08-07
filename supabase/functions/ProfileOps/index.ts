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
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
const clean = (value: unknown, max = 180) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const active = (value: unknown) => value === true || value === 1 || ["TRUE", "1"].includes(String(value || "").toUpperCase());

type SessionUser = { ID_User: string; Role: string | null; Status_Aktif: boolean | string | number | null };

async function authenticate(tokenValue: unknown): Promise<SessionUser> {
  const token = clean(tokenValue, 500);
  if (!token) throw new Error("SESSION_EXPIRED");
  const session = await db.from("Sessions").select("ID_User,Type,Expires_At").eq("Token", token).maybeSingle();
  if (session.error || !session.data?.ID_User || String(session.data.Type || "").toLowerCase() !== "user" || new Date(session.data.Expires_At).getTime() <= Date.now()) throw new Error("SESSION_EXPIRED");
  const user = await db.from("Users").select("ID_User,Role,Status_Aktif").eq("ID_User", session.data.ID_User).maybeSingle();
  if (user.error || !user.data || !active(user.data.Status_Aktif)) throw new Error("ACCOUNT_INACTIVE");
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

async function resolveFoundation(sppg: string, requestedFoundation: string): Promise<string> {
  if (!sppg) return requestedFoundation;
  const master = await db.from("Master_SPPG").select("Nama_SPPG,Yayasan,Aktif").ilike("Nama_SPPG", sppg).limit(1).maybeSingle();
  if (!master.error && master.data && active(master.data.Aktif)) return clean(master.data.Yayasan, 180) || requestedFoundation;
  return requestedFoundation;
}

async function getProfile(user: SessionUser) {
  const result = await db.from("Users").select("ID_User,Nama_Lengkap,NIK,Tempat_Lahir,Tanggal_Lahir,Jenis_Kelamin,Alamat,Email,No_Whatsapp,SPPG,Yayasan,Jabatan_Divisi,Tanggal_Mulai_Kerja,Gaji_Harian,Nama_Bank,Nomor_Rekening,Atas_Nama_Rekening").eq("ID_User", user.ID_User).maybeSingle();
  if (result.error || !result.data) throw new Error("Profil tidak ditemukan.");
  return result.data;
}

async function updateProfile(user: SessionUser, updatesValue: unknown) {
  const updates = updatesValue && typeof updatesValue === "object" ? updatesValue as Record<string, unknown> : {};
  if (Object.prototype.hasOwnProperty.call(updates, "Gaji_Harian")) throw new Error("Gaji Harian hanya dapat diubah oleh ADMIN/SUPER ADMIN melalui manajemen user.");
  if (Object.prototype.hasOwnProperty.call(updates, "Role") || Object.prototype.hasOwnProperty.call(updates, "Status_Aktif")) throw new Error("Role dan status akun tidak dapat diubah dari Profil.");

  const payload: Record<string, unknown> = {};
  const stringFields: Array<[string, number]> = [
    ["Nama_Lengkap",180],["NIK",32],["Tempat_Lahir",120],["Jenis_Kelamin",40],["Alamat",1200],["Email",254],["No_Whatsapp",40],
    ["Nama_Bank",120],["Nomor_Rekening",80],["Atas_Nama_Rekening",180],["SPPG",160],["Yayasan",180],["Jabatan_Divisi",180],
  ];
  for (const [field,max] of stringFields) if (updates[field] !== undefined) payload[field] = clean(updates[field], max);
  if (updates.Tanggal_Lahir !== undefined) payload.Tanggal_Lahir = dateOnly(updates.Tanggal_Lahir);
  if (updates.Tanggal_Mulai_Kerja !== undefined) payload.Tanggal_Mulai_Kerja = dateOnly(updates.Tanggal_Mulai_Kerja);
  if (!clean(payload.Nama_Lengkap ?? updates.Nama_Lengkap,180) && updates.Nama_Lengkap !== undefined) throw new Error("Nama lengkap tidak boleh kosong.");
  if (payload.NIK && !/^\d{16}$/.test(String(payload.NIK))) throw new Error("NIK harus terdiri dari 16 digit angka.");
  if (payload.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.Email))) throw new Error("Format email tidak valid.");

  const sppg = payload.SPPG !== undefined ? String(payload.SPPG) : "";
  const requestedFoundation = payload.Yayasan !== undefined ? String(payload.Yayasan) : "";
  if (payload.SPPG !== undefined || payload.Yayasan !== undefined) payload.Yayasan = await resolveFoundation(sppg, requestedFoundation);
  payload.Updated_At = new Date().toISOString();
  const result = await db.from("Users").update(payload).eq("ID_User", user.ID_User);
  if (result.error) throw new Error(`Gagal memperbarui profil: ${result.error.message}`);
  try {
    await db.from("Audit_Log").insert({ ID_Log:`AUD_${Date.now()}_${crypto.randomUUID().slice(0,8)}`, Waktu:new Date().toISOString(), ID_User_Pelaku:user.ID_User, Jenis_Aktivitas:"UPDATE_PROFIL", Detail:{ idUser:user.ID_User, fields:Object.keys(payload).filter((field)=>field!=="Updated_At"), protectedFields:["Gaji_Harian","Role","Status_Aktif"] } });
  } catch (error) { console.warn("Profile audit deferred", error); }
  return { success:true, message:"Profil dan data kepegawaian berhasil diperbarui.", profile:await getProfile(user) };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers:CORS });
  if (request.method !== "POST") return json({success:false,error:"Method tidak didukung."},405);
  try {
    const body = await request.json() as Record<string,unknown>;
    const action = clean(body.action || body.function,80) || "updateProfil";
    const user = await authenticate(body.token);
    const result = action === "updateProfil" ? await updateProfile(user,body.updates) : action === "getProfileEmployment" ? await getProfile(user) : null;
    if (!result) return json({success:false,error:"Aksi profil tidak didukung."},422);
    return json({success:true,result});
  } catch(error) {
    const raw=error instanceof Error?error.message:String(error);
    if(raw==="SESSION_EXPIRED") return json({success:false,error:"Sesi telah berakhir. Silakan login kembali."},401);
    if(raw==="ACCOUNT_INACTIVE") return json({success:false,error:"Akun tidak aktif atau tidak ditemukan."},403);
    const status=/tidak valid|tidak boleh|hanya dapat|Format|Tanggal|NIK/i.test(raw)?422:500;
    console.error(JSON.stringify({code:"PROFILE_OPS_ERROR",error:raw}));
    return json({success:false,error:status===500?"Gagal memperbarui profil.":raw},status);
  }
});
