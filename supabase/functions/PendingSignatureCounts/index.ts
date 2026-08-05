import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(url, key, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
});
const roleName = (value: unknown) => String(value || "").trim().toUpperCase().replace(/_/g, " ");
const active = (value: unknown) => value === true || value === 1 || ["TRUE", "1"].includes(String(value || "").toUpperCase());

async function authenticate(token: unknown) {
  const clean = String(token || "").trim();
  if (!clean) throw new Error("SESI_HABIS");
  const { data: session, error: sessionError } = await sb.from("Sessions")
    .select("ID_User,Type,Expires_At").eq("Token", clean).maybeSingle();
  if (sessionError || !session || String(session.Type).toLowerCase() !== "user" || new Date(session.Expires_At).getTime() <= Date.now()) {
    throw new Error("SESI_HABIS");
  }
  const { data: user, error: userError } = await sb.from("Users")
    .select("ID_User,Email,Role,SPPG,Status_Aktif").eq("ID_User", session.ID_User).maybeSingle();
  if (userError || !user || !active(user.Status_Aktif)) throw new Error("AKUN_NONAKTIF");
  return { ...user, role: roleName(user.Role) };
}

async function scopedUserIds(auth: any): Promise<string[]> {
  if (auth.role === "USER") return [String(auth.ID_User)];
  if (auth.role === "SUPER ADMIN") {
    const { data, error } = await sb.from("Users").select("ID_User,Role");
    if (error) throw error;
    return (data || []).filter((row: any) => roleName(row.Role) === "USER").map((row: any) => String(row.ID_User));
  }
  if (!["ADMIN", "AKUNTAN"].includes(auth.role)) throw new Error("Akses ditolak");
  const { data: access, error: accessError } = await sb.from("Akses_Email")
    .select("SPPG,Aktif").ilike("Email", String(auth.Email || ""));
  if (accessError) throw accessError;
  const sppg = [...new Set((access || []).filter((row: any) => active(row.Aktif))
    .map((row: any) => String(row.SPPG || "").trim()).filter(Boolean))];
  if (!sppg.length && auth.SPPG) sppg.push(String(auth.SPPG));
  if (!sppg.length) return [];
  const { data, error } = await sb.from("Users").select("ID_User,Role").in("SPPG", sppg);
  if (error) throw error;
  return (data || []).filter((row: any) => roleName(row.Role) === "USER").map((row: any) => String(row.ID_User));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method tidak didukung" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(body.token);
    const ids = await scopedUserIds(auth);
    if (!ids.length) return json({ success: true, count: 0, ownCount: 0, role: auth.role });
    const ownQuery = sb.from("Slip_Gaji").select("ID_Slip", { count: "exact", head: true })
      .eq("ID_User", auth.ID_User).eq("Status_Penerbitan", "MENUNGGU_TTD_PENERIMA");
    const scopeQuery = sb.from("Slip_Gaji").select("ID_Slip", { count: "exact", head: true })
      .in("ID_User", ids).eq("Status_Penerbitan", "MENUNGGU_TTD_PENERIMA");
    const [own, scope] = await Promise.all([ownQuery, scopeQuery]);
    if (own.error) throw own.error;
    if (scope.error) throw scope.error;
    return json({ success: true, count: Number(scope.count || 0), ownCount: Number(own.count || 0), role: auth.role });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
