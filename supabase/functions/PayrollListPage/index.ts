import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL, KEY, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const active = (value: unknown) => value === true || value === 1 || ["TRUE", "1"].includes(String(value || "").toUpperCase());
const roleName = (value: unknown) => String(value || "").trim().toUpperCase().replace(/_/g, " ");
const messageOf = (error: any) => error?.message || error?.details || error?.hint || String(error || "Terjadi kesalahan");
const ok = (result: unknown) => json({ success: true, result });

async function authenticate(token: unknown) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) throw new Error("SESI_HABIS");
  const { data: session, error: sessionError } = await db.from("Sessions").select("ID_User,Type,Expires_At").eq("Token", cleanToken).maybeSingle();
  if (sessionError || !session || String(session.Type).toLowerCase() !== "user" || new Date(session.Expires_At).getTime() < Date.now()) throw new Error("SESI_HABIS");
  const { data: user, error: userError } = await db.from("Users").select("ID_User,Email,Role,SPPG,Status_Aktif").eq("ID_User", session.ID_User).maybeSingle();
  if (userError || !user || !active(user.Status_Aktif)) throw new Error("AKUN_NONAKTIF");
  const role = roleName(user.Role);
  if (!["ADMIN", "SUPER ADMIN", "AKUNTAN"].includes(role)) throw new Error("Akses ditolak");
  return { ...user, role };
}

async function scopedUserIds(auth: any): Promise<string[]> {
  if (auth.role === "SUPER ADMIN") {
    const { data, error } = await db.from("Users").select("ID_User,Role");
    if (error) throw new Error(messageOf(error));
    return (data || []).filter((row: any) => roleName(row.Role) !== "SUPER ADMIN").map((row: any) => String(row.ID_User));
  }
  const { data: accessRows, error: accessError } = await db.from("Akses_Email").select("SPPG,Aktif").ilike("Email", String(auth.Email || ""));
  if (accessError) throw new Error(messageOf(accessError));
  const sppg = [...new Set((accessRows || []).filter((row: any) => active(row.Aktif)).map((row: any) => String(row.SPPG || "").trim()).filter(Boolean))];
  if (!sppg.length) return [String(auth.ID_User)];
  const { data, error } = await db.from("Users").select("ID_User,Role").in("SPPG", sppg);
  if (error) throw new Error(messageOf(error));
  return (data || []).filter((row: any) => roleName(row.Role) !== "SUPER ADMIN").map((row: any) => String(row.ID_User));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Method tidak didukung" }, 405);
  try {
    const body = await req.json();
    const auth = await authenticate(body.token);
    const userIds = await scopedUserIds(auth);
    const page = Math.max(1, Number(body.page) || 1);
    const pageSize = Math.min(30, Math.max(1, Number(body.pageSize) || 30));
    const status = String(body.status || "HISTORY").trim().toUpperCase();
    if (!["HISTORY", "DITERBITKAN", "MENUNGGU_TTD_PENERIMA"].includes(status)) throw new Error("Status slip tidak valid");
    if (!userIds.length) return ok({ items: [], total: 0, page, pageSize, totalPages: 0 });

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query = db.from("Slip_Gaji")
      .select("ID_Slip,ID_Payroll,ID_User,Periode_Mulai,Periode_Akhir,Jumlah_Hari_Kerja,Gaji_Harian,Bonus,Potongan,Total_Gaji_Diterima,Status_Penerbitan,Diterbitkan_At,Created_At,Nama_Penerbit,PDF_Storage_Path", { count: "exact" })
      .in("ID_User", userIds);
    query = status === "HISTORY"
      ? query.in("Status_Penerbitan", ["MENUNGGU_TTD_PENERIMA", "DITERBITKAN"])
      : query.eq("Status_Penerbitan", status);
    const { data: slips, error, count } = await query.order("Diterbitkan_At", { ascending: false, nullsFirst: false }).order("ID_Slip", { ascending: true }).range(from, to);
    if (error) throw new Error(messageOf(error));

    const pageUserIds = [...new Set((slips || []).map((row: any) => String(row.ID_User)).filter(Boolean))];
    const { data: users, error: usersError } = pageUserIds.length
      ? await db.from("Users").select("ID_User,Nama_Lengkap,Jabatan_Divisi,SPPG").in("ID_User", pageUserIds)
      : { data: [], error: null };
    if (usersError) throw new Error(messageOf(usersError));
    const userMap = new Map((users || []).map((row: any) => [String(row.ID_User), row]));

    const items = (slips || []).map((row: any) => {
      const user = userMap.get(String(row.ID_User)) as any;
      return {
        ID_Slip: row.ID_Slip, ID_Payroll: row.ID_Payroll, ID_User: row.ID_User,
        Nama_Lengkap: user?.Nama_Lengkap || "-", Jabatan_Divisi: user?.Jabatan_Divisi || "-", SPPG: user?.SPPG || "-",
        Periode_Mulai: row.Periode_Mulai, Periode_Akhir: row.Periode_Akhir, Jumlah_Hari_Kerja: row.Jumlah_Hari_Kerja,
        Gaji_Harian: row.Gaji_Harian, Bonus: row.Bonus, Potongan: row.Potongan, Total_Gaji_Diterima: row.Total_Gaji_Diterima,
        Status_Penerbitan: row.Status_Penerbitan, Diterbitkan_At: row.Diterbitkan_At, Created_At: row.Created_At,
        Nama_Penerbit: row.Nama_Penerbit, PDF_Storage_Path: row.PDF_Storage_Path,
      };
    });
    const total = Number(count || 0);
    return ok({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (error) {
    return json({ success: false, error: messageOf(error) }, 400);
  }
});
