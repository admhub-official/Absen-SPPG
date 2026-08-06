import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MAX_RADIUS_METER = 100;
const DEFAULT_LOCATION_KEY = "DEFAULT";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  function?: string;
  data?: Record<string, unknown>;
};

type SuperAdminIdentity = {
  idUser: string;
  email: string;
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeRole(value: unknown): string {
  return String(value || "").trim().toUpperCase().replace(/_/g, " ");
}

function isActive(value: unknown): boolean {
  return value === true || value === 1 || ["TRUE", "1"].includes(String(value || "").toUpperCase());
}

function normalizeSppgKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^SPPG[\s_-]*/, "")
    .replace(/[^A-Z0-9]+/g, "");
}

function coordinate(value: unknown, min: number, max: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} tidak valid.`);
  }
  return parsed;
}

async function requireSuperAdmin(tokenValue: unknown): Promise<SuperAdminIdentity> {
  const token = String(tokenValue || "").trim();
  if (!token) throw new Error("SESI_HABIS");

  const sessionResult = await db
    .from("Sessions")
    .select("ID_User, Type, Expires_At")
    .eq("Token", token)
    .maybeSingle();
  const session = sessionResult.data;
  if (
    sessionResult.error || !session?.ID_User ||
    String(session.Type || "").toLowerCase() !== "user" ||
    new Date(session.Expires_At).getTime() <= Date.now()
  ) {
    throw new Error("SESI_HABIS");
  }

  const userResult = await db
    .from("Users")
    .select("ID_User, Email, Role, Status_Aktif")
    .eq("ID_User", session.ID_User)
    .maybeSingle();
  const user = userResult.data;
  if (userResult.error || !user || !isActive(user.Status_Aktif)) {
    throw new Error("AKUN_NONAKTIF");
  }
  if (normalizeRole(user.Role) !== "SUPER ADMIN") {
    throw new Error("Akses ditolak. Konfigurasi lokasi hanya untuk SUPER ADMIN.");
  }

  return {
    idUser: String(user.ID_User),
    email: String(user.Email || ""),
  };
}

async function getConfiguration(data: Record<string, unknown>): Promise<unknown> {
  await requireSuperAdmin(data.token);

  const [masterResult, locationResult] = await Promise.all([
    db
      .from("Master_SPPG")
      .select("Nama_SPPG, Yayasan, Aktif")
      .order("Nama_SPPG", { ascending: true }),
    db
      .from("Lokasi_SPPG")
      .select("Kunci_SPPG, Nama_SPPG, Latitude, Longitude, Radius_Meter, Aktif, Catatan, Updated_At")
      .order("Nama_SPPG", { ascending: true }),
  ]);

  if (masterResult.error) {
    throw new Error("Gagal membaca master SPPG: " + masterResult.error.message);
  }
  if (locationResult.error) {
    throw new Error("Gagal membaca konfigurasi lokasi SPPG: " + locationResult.error.message);
  }

  return {
    maxRadiusMeter: MAX_RADIUS_METER,
    masterSppg: (masterResult.data || []).filter((row) => isActive(row.Aktif)),
    locations: locationResult.data || [],
  };
}

async function saveConfiguration(data: Record<string, unknown>): Promise<unknown> {
  const actor = await requireSuperAdmin(data.token);
  const requestedKey = String(data.kunciSppg || "").trim().toUpperCase();
  const requestedName = String(data.namaSppg || "").trim();
  const key = requestedKey === DEFAULT_LOCATION_KEY
    ? DEFAULT_LOCATION_KEY
    : normalizeSppgKey(requestedKey || requestedName);
  if (!key || !/^[A-Z0-9]{2,80}$/.test(key)) {
    throw new Error("SPPG belum dipilih atau kunci SPPG tidak valid.");
  }

  const latitude = coordinate(data.latitude, -90, 90, "Latitude");
  const longitude = coordinate(data.longitude, -180, 180, "Longitude");
  const radius = Math.round(Number(data.radiusMeter));
  if (!Number.isFinite(radius) || radius < 1 || radius > MAX_RADIUS_METER) {
    throw new Error(`Radius harus antara 1 sampai ${MAX_RADIUS_METER} meter.`);
  }

  const catatan = String(data.catatan || "").trim().slice(0, 500);
  const aktif = data.aktif !== false && String(data.aktif).toLowerCase() !== "false";

  const [existingResult, masterResult] = await Promise.all([
    db
      .from("Lokasi_SPPG")
      .select("Kunci_SPPG, Nama_SPPG, Latitude, Longitude, Radius_Meter, Aktif, Catatan")
      .eq("Kunci_SPPG", key)
      .maybeSingle(),
    db.from("Master_SPPG").select("Nama_SPPG, Yayasan, Aktif"),
  ]);
  if (existingResult.error) {
    throw new Error("Gagal membaca konfigurasi lokasi lama: " + existingResult.error.message);
  }
  if (masterResult.error) {
    throw new Error("Gagal memvalidasi master SPPG: " + masterResult.error.message);
  }

  let canonicalName = requestedName;
  if (key === DEFAULT_LOCATION_KEY) {
    canonicalName = canonicalName || "Titik cadangan SPPG lainnya";
  } else {
    const master = (masterResult.data || []).find((row) =>
      isActive(row.Aktif) && normalizeSppgKey(row.Nama_SPPG) === key
    );
    if (master) canonicalName = String(master.Nama_SPPG || canonicalName);
    if (!master && !existingResult.data) {
      throw new Error("SPPG tidak ditemukan pada master SPPG aktif.");
    }
    canonicalName = canonicalName || String(existingResult.data?.Nama_SPPG || key);
  }

  const payload = {
    Kunci_SPPG: key,
    Nama_SPPG: canonicalName,
    Latitude: latitude,
    Longitude: longitude,
    Radius_Meter: radius,
    Aktif: aktif,
    Catatan: catatan || null,
    Updated_At: new Date().toISOString(),
  };

  const savedResult = await db
    .from("Lokasi_SPPG")
    .upsert(payload, { onConflict: "Kunci_SPPG" })
    .select("Kunci_SPPG, Nama_SPPG, Latitude, Longitude, Radius_Meter, Aktif, Catatan, Updated_At")
    .single();
  if (savedResult.error) {
    throw new Error("Gagal menyimpan konfigurasi lokasi SPPG: " + savedResult.error.message);
  }

  const auditResult = await db.from("Audit_Log").insert({
    ID_Log: `AUDIT_LOC_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    Waktu: new Date().toISOString(),
    ID_User_Pelaku: actor.idUser,
    Jenis_Aktivitas: "UPDATE_LOKASI_SPPG",
    Detail: {
      actorEmail: actor.email,
      kunciSppg: key,
      before: existingResult.data || null,
      after: savedResult.data,
    },
    IP_Address: null,
  });
  if (auditResult.error) {
    console.error("Gagal menyimpan audit konfigurasi lokasi SPPG", auditResult.error.message);
  }

  return {
    message: `Lokasi ${canonicalName} berhasil diperbarui.`,
    location: savedResult.data,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return response({ success: false, error: "Method tidak didukung." }, 405);
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return response({ success: false, error: "Body request harus berupa JSON valid." }, 400);
  }

  try {
    const data = body.data || {};
    if (body.function === "getSppgLocationConfiguration") {
      return response({ success: true, result: await getConfiguration(data) });
    }
    if (body.function === "saveSppgLocationConfiguration") {
      return response({ success: true, result: await saveConfiguration(data) });
    }
    return response({ success: false, error: "Fungsi tidak dikenali." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`SppgLocationConfig error (${body.function || "unknown"})`, error);
    return response({ success: false, error: message });
  }
});
