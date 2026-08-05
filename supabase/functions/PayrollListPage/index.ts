import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const active = (value: unknown) => value === true || value === 1 || ["TRUE", "1"].includes(String(value || "").toUpperCase());
const roleName = (value: unknown) => String(value || "").trim().toUpperCase().replace(/_/g, " ");

async function authenticate(token: unknown) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) throw new Error("SESI_HABIS");
  const { data: session, error: sessionError } = await supabase
    .from("Sessions")
    .select("ID_User,Type,Expires_At")
    .eq("Token", cleanToken)
    .maybeSingle();
  if (sessionError || !session || String(session.Type).toLowerCase() !== "user" || new Date(session.Expires_At).getTime() < Date.now()) {
    throw new Error("SESI_HABIS");
  }
  const { data: user, error: userError } = await supabase
    .from("Users")
    .select("ID_User,Email,Role,SPPG,Status_Aktif")
    .eq("ID_User", session.ID_User)
    .maybeSingle();
  if (userError || !user || !active(user.Status_Aktif)) throw new Error("AKUN_NONAKTIF");
  const role = roleName(user.Role);
  if (!["ADMIN", "SUPER ADMIN", "AKUNTAN"].includes(role)) throw new Error("Akses ditolak");
  return { ...user, role };
}

async function scopedUserIds(auth: any): Promise<string[]> {
  if (auth.role === "SUPER ADMIN") {
    const { data, error } = await supabase.from("Users").select("ID_User,Role");
    if (error) throw error;
    return (data || []).filter((row: any) => roleName(row.Role) !== "SUPER ADMIN").map((row: any) => String(row.ID_User));
  }
  const { data: accessRows, error: accessError } = await supabase
    .from("Akses_Email")
    .select("SPPG,Aktif")
    .ilike("Email", String(auth.Email || ""));
  if (accessError) throw accessError;
  const sppg = [...new Set((accessRows || []).filter((row: any) => active(row.Aktif)).map((row: any) => String(row.SPPG || "").trim()).filter(Boolean))];
  if (!sppg.length) return [String(auth.ID_User)];
  const { data, error } = await supabase.from("Users").select("ID_User,Role").in("SPPG", sppg);
  if (error) throw error;
  return (data || []).filter((row: any) => roleName(row.Role) !== "SUPER ADMIN").map((row: any) => String(row.ID_User));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method tidak didukung" }, 405);
  try {
    const body = await req.json();
    const auth = await authenticate(body.token);
    const userIds = await scopedUserIds(auth);
    const page = Math.max(1, Number(body.page) || 1);
    const pageSize = Math.min(30, Math.max(1, Number(body.pageSize) || 30));
    const status = String(body.status || "DITERBITKAN").trim().toUpperCase();
    if (!["DITERBITKAN", "DRAFT"].includes(status)) throw new Error("Status slip tidak valid");
    if (!userIds.length) return json({ success: true, items: [], total: 0, page, pageSize, totalPages: 0 });

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data: slips, error, count } = await supabase
      .from("Slip_Gaji")
      .select("ID_Slip,ID_Payroll,ID_User,Periode_Mulai,Periode_Akhir,Jumlah_Hari_Kerja,Gaji_Harian,Bonus,Potongan,Total_Gaji_Diterima,Status_Penerbitan,Diterbitkan_At,Created_At,Nama_Penerbit,PDF_Storage_Path,Users!inner(Nama_Lengkap,Jabatan_Divisi,SPPG)", { count: "exact" })
      .in("ID_User", userIds)
      .eq("Status_Penerbitan", status)
      .order(status === "DITERBITKAN" ? "Diterbitkan_At" : "Created_At", { ascending: false, nullsFirst: false })
      .order("ID_Slip", { ascending: true })
      .range(from, to);
    if (error) throw error;

    const items = (slips || []).map((row: any) => {
      const user = Array.isArray(row.Users) ? row.Users[0] : row.Users;
      return {
        ID_Slip: row.ID_Slip,
        ID_Payroll: row.ID_Payroll,
        ID_User: row.ID_User,
        Nama_Lengkap: user?.Nama_Lengkap || "-",
        Jabatan_Divisi: user?.Jabatan_Divisi || "-",
        SPPG: user?.SPPG || "-",
        Periode_Mulai: row.Periode_Mulai,
        Periode_Akhir: row.Periode_Akhir,
        Jumlah_Hari_Kerja: row.Jumlah_Hari_Kerja,
        Gaji_Harian: row.Gaji_Harian,
        Bonus: row.Bonus,
        Potongan: row.Potongan,
        Total_Gaji_Diterima: row.Total_Gaji_Diterima,
        Status_Penerbitan: row.Status_Penerbitan,
        Diterbitkan_At: row.Diterbitkan_At,
        Created_At: row.Created_At,
        Nama_Penerbit: row.Nama_Penerbit,
        PDF_Storage_Path: row.PDF_Storage_Path,
      };
    });
    const total = Number(count || 0);
    return json({ success: true, items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ success: false, error: message }, 400);
  }
});
