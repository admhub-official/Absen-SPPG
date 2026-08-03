import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const allowedOrigins = () => {
  const values = new Set((Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "").split(",").map((v) => v.trim()).filter(Boolean));
  values.add("https://absen-sppg.pages.dev");
  values.add("http://localhost:4173");
  values.add("http://127.0.0.1:4173");
  return values;
};

function originAllowed(origin: string): boolean {
  if (allowedOrigins().has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "absen-sppg.pages.dev" || url.hostname.endsWith(".absen-sppg.pages.dev"));
  } catch { return false; }
}

function headers(origin: string | null) {
  return {
    ...(origin && originAllowed(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Auth = { idUser: string; role: string; token: string };
async function authenticate(tokenValue: unknown): Promise<Auth> {
  const token = String(tokenValue || "").trim();
  if (!token) throw new Error("SESSION_EXPIRED");
  const sessionResult = await supabase.from("Sessions").select("ID_User,Type,Expires_At").eq("Token", token).maybeSingle();
  const session = sessionResult.data;
  if (sessionResult.error || !session?.ID_User || String(session.Type || "").toLowerCase() !== "user" || new Date(session.Expires_At).getTime() <= Date.now()) throw new Error("SESSION_EXPIRED");
  const userResult = await supabase.from("Users").select("ID_User,Role,Status_Aktif").eq("ID_User", session.ID_User).maybeSingle();
  const user = userResult.data;
  const active = user?.Status_Aktif === true || ["TRUE", "1"].includes(String(user?.Status_Aktif || "").toUpperCase());
  if (userResult.error || !user || !active) throw new Error("ACCOUNT_INACTIVE");
  return { idUser: String(user.ID_User), role: String(user.Role || "").toUpperCase().replace(/_/g, " "), token };
}

function clientIp(request: Request): string {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "").slice(0, 128);
}

function normalizeDevice(body: Record<string, unknown>, request: Request) {
  const deviceKey = String(body.deviceKey || "").trim();
  if (deviceKey.length < 32 || deviceKey.length > 200) throw new Error("DEVICE_KEY_INVALID");
  return {
    deviceKey,
    name: String(body.deviceName || "Perangkat tanpa nama").trim().slice(0, 120),
    platform: String(body.platform || "").trim().slice(0, 120),
    browser: String(body.browser || "").trim().slice(0, 120),
    userAgent: (request.headers.get("user-agent") || "").slice(0, 500),
  };
}

async function registerDevice(auth: Auth, body: Record<string, unknown>, request: Request) {
  const d = normalizeDevice(body, request);
  const hash = await sha256(d.deviceKey);
  const existing = await supabase.from("Attendance_Devices")
    .select("Device_ID,Status,Risk_Score,Device_Name,First_Seen_At,Last_Seen_At")
    .eq("ID_User", auth.idUser).eq("Device_Key_Hash", hash).maybeSingle();
  if (existing.error) throw new Error("DEVICE_LOOKUP_FAILED");
  if (existing.data) {
    const { data, error } = await supabase.from("Attendance_Devices").update({
      Device_Name: d.name,
      Platform: d.platform,
      Browser: d.browser,
      User_Agent: d.userAgent,
      Last_IP: clientIp(request) || null,
      Last_Seen_At: new Date().toISOString(),
      Updated_At: new Date().toISOString(),
    }).eq("Device_ID", existing.data.Device_ID)
      .select("Device_ID,Status,Risk_Score,Device_Name,First_Seen_At,Last_Seen_At").single();
    if (error) throw new Error("DEVICE_UPDATE_FAILED");
    return data;
  }

  const { data, error } = await supabase.from("Attendance_Devices").insert({
    ID_User: auth.idUser,
    Device_Key_Hash: hash,
    Device_Name: d.name,
    Platform: d.platform,
    Browser: d.browser,
    User_Agent: d.userAgent,
    Last_IP: clientIp(request) || null,
    Risk_Score: 20,
    Status: "PENDING",
  }).select("Device_ID,Status,Risk_Score,Device_Name,First_Seen_At,Last_Seen_At").single();
  if (error) throw new Error("DEVICE_REGISTER_FAILED");
  return data;
}

async function listMyDevices(auth: Auth) {
  const { data, error } = await supabase.from("Attendance_Devices")
    .select("Device_ID,Device_Name,Platform,Browser,Status,Risk_Score,First_Seen_At,Last_Seen_At,Last_Attendance_At,Last_IP,Reviewed_At,Revoked_At")
    .eq("ID_User", auth.idUser).order("Last_Seen_At", { ascending: false });
  if (error) throw new Error("DEVICE_LIST_FAILED");
  return data || [];
}

async function revokeMyDevice(auth: Auth, body: Record<string, unknown>) {
  const id = String(body.deviceId || "").trim();
  if (!id) throw new Error("DEVICE_ID_REQUIRED");
  const { data, error } = await supabase.from("Attendance_Devices").update({
    Status: "REVOKED", Revoked_At: new Date().toISOString(), Updated_At: new Date().toISOString(), Trust_Reason: "Dicabut oleh pemilik perangkat",
  }).eq("Device_ID", id).eq("ID_User", auth.idUser)
    .select("Device_ID,Status").maybeSingle();
  if (error || !data) throw new Error("DEVICE_NOT_FOUND");
  return data;
}

async function listReviewQueue(auth: Auth, body: Record<string, unknown>) {
  if (!["ADMIN", "SUPER ADMIN"].includes(auth.role)) throw new Error("FORBIDDEN");
  const status = String(body.status || "PENDING").toUpperCase();
  const limit = Math.min(100, Math.max(10, Number(body.limit) || 50));
  let query = supabase.from("Attendance_Devices")
    .select("Device_ID,ID_User,Device_Name,Platform,Browser,Status,Risk_Score,First_Seen_At,Last_Seen_At,Last_Attendance_At,Last_IP,Trust_Reason")
    .order("Risk_Score", { ascending: false }).order("Last_Seen_At", { ascending: false }).limit(limit);
  if (["PENDING","TRUSTED","REVOKED","BLOCKED"].includes(status)) query = query.eq("Status", status);
  const { data, error } = await query;
  if (error) throw new Error("DEVICE_REVIEW_LIST_FAILED");
  return data || [];
}

async function reviewDevice(auth: Auth, body: Record<string, unknown>) {
  if (!["ADMIN", "SUPER ADMIN"].includes(auth.role)) throw new Error("FORBIDDEN");
  const deviceId = String(body.deviceId || "").trim();
  const status = String(body.status || "").toUpperCase();
  const reason = String(body.reason || "").trim();
  const { data, error } = await supabase.rpc("review_attendance_device", {
    p_actor_user_id: auth.idUser,
    p_device_id: deviceId,
    p_status: status,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

function mapError(error: unknown) {
  const code = String(error instanceof Error ? error.message : error || "INTERNAL_ERROR");
  if (code === "SESSION_EXPIRED") return { status: 401, code, message: "Sesi telah berakhir. Silakan login kembali." };
  if (code === "ACCOUNT_INACTIVE" || code === "FORBIDDEN") return { status: 403, code, message: "Akses ditolak." };
  if (code.includes("NOT_FOUND")) return { status: 404, code, message: "Perangkat tidak ditemukan." };
  if (code.includes("REASON_REQUIRED")) return { status: 422, code, message: "Alasan review minimal 10 karakter." };
  if (code.includes("INVALID") || code.includes("REQUIRED")) return { status: 422, code, message: "Data perangkat tidak valid." };
  return { status: 500, code: "INTERNAL_ERROR", message: "Terjadi kesalahan pada server." };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !originAllowed(origin)) return response({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin tidak diizinkan." }, 403, origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (request.method !== "POST") return response({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan metode POST." }, 405, origin);

  try {
    const body = await request.json() as Record<string, unknown>;
    const auth = await authenticate(body.token);
    const action = String(body.action || "").trim();
    let result: unknown;
    if (action === "registerDevice") result = await registerDevice(auth, body, request);
    else if (action === "listMyDevices") result = await listMyDevices(auth);
    else if (action === "revokeMyDevice") result = await revokeMyDevice(auth, body);
    else if (action === "listReviewQueue") result = await listReviewQueue(auth, body);
    else if (action === "reviewDevice") result = await reviewDevice(auth, body);
    else throw new Error("ACTION_INVALID");
    return response({ success: true, result }, 200, origin);
  } catch (error) {
    const mapped = mapError(error);
    return response({ success: false, code: mapped.code, message: mapped.message }, mapped.status, origin);
  }
});
