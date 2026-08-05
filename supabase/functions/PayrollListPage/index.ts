import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL, KEY, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const text = (value: unknown) => String(value ?? "").trim();
const roleName = (value: unknown) => text(value).toUpperCase().replace(/_/g, " ");
const isActive = (value: unknown) => value === true || value === 1 || ["TRUE", "1"].includes(text(value).toUpperCase());
const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return text(value.message || value.details || value.hint || JSON.stringify(value));
  }
  return text(error) || "Terjadi kesalahan yang tidak diketahui";
};

async function authenticate(token: unknown) {
  const cleanToken = text(token);
  if (!cleanToken) throw new Error("SESI_HABIS");
  const { data: session, error } = await db.from("Sessions")
    .select("ID_User,Type,Expires_At").eq("Token", cleanToken).maybeSingle();
  if (error || !session || text(session.Type).toLowerCase() !== "user" || new Date(session.Expires_At).getTime() < Date.now()) {
    throw new Error("SESI_HABIS");
  }
  const { data: user, error: userError } = await db.from("Users")
    .select("ID_User,Email,Role,SPPG,Status_Aktif").eq("ID_User", session.ID_User).maybeSingle();
  if (userError || !user || !isActive(user.Status_Aktif)) throw new Error("AKUN_NONAKTIF");
  const role = roleName(user.Role);
  if (!["ADMIN", "SUPER ADMIN", "AKUNTAN"].includes(role)) throw new Error("Akses ditolak");
  return { ...user, role };
}

async function allowedSppg(auth: any): Promise<string[] | null> {
  if (auth.role === "SUPER ADMIN") return null;
  const { data, error } = await db.from("Akses_Email").select("SPPG,Aktif").ilike("Email", text(auth.Email));
  if (error) throw new Error(error.message);
  const values = [...new Set((data || []).filter((row: any) => isActive(row.Aktif)).map((row: any) => text(row.SPPG)).filter(Boolean))];
  return values.length ? values : [text(auth.SPPG)].filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Method tidak didukung" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(body.token);
    const sppg = await allowedSppg(auth);
    const page = Math.max(1, Number(body.page) || 1);
    const pageSize = Math.min(30, Math.max(1, Number(body.pageSize) || 30));
    const status = text(body.status || "HISTORY").toUpperCase();
    if (!["HISTORY", "DITERBITKAN", "MENUNGGU_TTD_PENERIMA"].includes(status)) throw new Error("Status slip tidak valid");

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query = db.from("Slip_Gaji").select(
      "ID_Slip,ID_Payroll,ID_User,Periode_Mulai,Periode_Akhir,Jumlah_Hari_Kerja,Gaji_Harian,Bonus,Potongan,Total_Gaji_Diterima,Status_Penerbitan,Diterbitkan_At,Created_At,Nama_Penerbit,PDF_Storage_Path,Users!inner(Nama_Lengkap,Jabatan_Divisi,SPPG,Role)",
      { count: "exact" },
    );
    if (sppg?.length) query = query.in("Users.SPPG", sppg);
    query = status === "HISTORY"
      ? query.in("Status_Penerbitan", ["MENUNGGU_TTD_PENERIMA", "DITERBITKAN"])
      : query.eq("Status_Penerbitan", status);

    const { data, error, count } = await query
      .order("Diterbitkan_At", { ascending: false, nullsFirst: false })
      .order("ID_Slip", { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message || error.details || "Query riwayat gagal");

    const items = (data || []).filter((row: any) => {
      const user = Array.isArray(row.Users) ? row.Users[0] : row.Users;
      return roleName(user?.Role) !== "SUPER ADMIN";
    }).map((row: any) => {
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
    return json({ success: false, error: errorMessage(error) }, 400);
  }
});
