import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/AbsenCore`;
const MAX_RADIUS_METER = 50;
const DEFAULT_LOCATION_KEY = "DEFAULT";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function okResult(result: unknown): Response {
  return jsonResponse({ success: true, result });
}

function errResult(message: string, status = 200): Response {
  return jsonResponse({ success: false, error: message }, status);
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

function hitungJarakMeter(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadius = 6_371_000;
  const toRad = (degree: number) => degree * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface AuthenticatedUser {
  idUser: string;
  sppg: string;
}

interface LocationResult {
  valid: boolean;
  message?: string;
  distance: number | null;
  radius: number;
  referenceName: string;
  latitude: number | null;
  longitude: number | null;
}

async function authenticateUser(token: unknown): Promise<AuthenticatedUser> {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) throw new Error("SESI_HABIS");

  const { data: session, error: sessionError } = await supabase
    .from("Sessions")
    .select("Type, ID_User, Expires_At")
    .eq("Token", cleanToken)
    .maybeSingle();
  if (sessionError || !session || new Date(session.Expires_At).getTime() < Date.now()) {
    throw new Error("SESI_HABIS");
  }
  if (String(session.Type || "").toLowerCase() !== "user" || !session.ID_User) {
    throw new Error("Akses ditolak. Hanya untuk pengguna yang sudah login.");
  }

  const { data: user, error: userError } = await supabase
    .from("Users")
    .select("ID_User, SPPG, Status_Aktif")
    .eq("ID_User", session.ID_User)
    .maybeSingle();
  if (userError || !user || !isActive(user.Status_Aktif)) {
    throw new Error("AKUN_NONAKTIF");
  }

  return { idUser: String(user.ID_User), sppg: String(user.SPPG || "") };
}

async function validateLocation(sppg: string, rawLat: unknown, rawLng: unknown): Promise<LocationResult> {
  if (rawLat === null || rawLat === undefined || rawLng === null || rawLng === undefined) {
    return {
      valid: false,
      message: "Lokasi GPS tidak terdeteksi. Aktifkan layanan lokasi dan coba lagi.",
      distance: null,
      radius: MAX_RADIUS_METER,
      referenceName: sppg || "SPPG",
      latitude: null,
      longitude: null,
    };
  }

  const latitude = Number(rawLat);
  const longitude = Number(rawLng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return {
      valid: false,
      message: "Koordinat GPS tidak valid. Muat ulang lokasi dan coba lagi.",
      distance: null,
      radius: MAX_RADIUS_METER,
      referenceName: sppg || "SPPG",
      latitude: null,
      longitude: null,
    };
  }

  const key = normalizeSppgKey(sppg);
  const keys = [...new Set([key, DEFAULT_LOCATION_KEY].filter(Boolean))];
  const { data: rows, error } = await supabase
    .from("Lokasi_SPPG")
    .select("Kunci_SPPG, Nama_SPPG, Latitude, Longitude, Radius_Meter, Aktif")
    .in("Kunci_SPPG", keys)
    .eq("Aktif", true);
  if (error) throw new Error("Gagal membaca konfigurasi lokasi SPPG: " + error.message);

  const exact = (rows || []).find((row: any) => row.Kunci_SPPG === key);
  const fallback = (rows || []).find((row: any) => row.Kunci_SPPG === DEFAULT_LOCATION_KEY);
  const reference: any = exact || fallback;
  if (!reference) throw new Error("Konfigurasi lokasi absensi belum tersedia. Hubungi Admin.");

  const radius = Math.min(MAX_RADIUS_METER, Math.max(1, Number(reference.Radius_Meter) || MAX_RADIUS_METER));
  const distance = Math.round(hitungJarakMeter(
    Number(reference.Latitude),
    Number(reference.Longitude),
    latitude,
    longitude,
  ));
  const valid = distance <= radius;

  return {
    valid,
    message: valid
      ? undefined
      : `Anda berada di luar radius lokasi SPPG ${sppg || reference.Nama_SPPG} (jarak: ${distance} meter, maksimal ${radius} meter).`,
    distance,
    radius,
    referenceName: String(reference.Nama_SPPG || sppg || "SPPG"),
    latitude,
    longitude,
  };
}

async function writeAudit(activity: string, detail: Record<string, unknown>, idUser: string): Promise<void> {
  try {
    await supabase.from("Audit_Log").insert({
      ID_Log: `LOG_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      Waktu: new Date().toISOString(),
      ID_User_Pelaku: idUser,
      Jenis_Aktivitas: activity,
      Detail: detail,
      IP_Address: "N/A",
    });
  } catch (error) {
    console.error("Geofence audit failed", error);
  }
}

function coreCompatibilityPoint(sppg: string, actualLat: number, actualLng: number): { lat: number; lng: number } {
  const key = normalizeSppgKey(sppg);
  if (key === "CISITU") return { lat: -6.889491, lng: 108.044861 };
  if (["DARMARAJA", "TANJUNGMEDAR", "CIAMIS", "PAKUALAM", "CIAWI", "CINTAJAYA", "KIRISIK"].includes(key)) {
    return { lat: -6.9186993373214465, lng: 108.07174565889278 };
  }
  return { lat: actualLat, lng: actualLng };
}

async function forwardToCore(body: unknown): Promise<Response> {
  const response = await fetch(CORE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function handleLocationCheck(data: Record<string, unknown>): Promise<Response> {
  const auth = await authenticateUser(data.token);
  const result = await validateLocation(auth.sppg, data.lat, data.lng);
  const accuracy = data.accuracy == null ? null : Number(data.accuracy);

  if (!result.valid) {
    await writeAudit("CEK_LOKASI_ABSEN_DITOLAK", {
      sppg: auth.sppg,
      latitude: result.latitude,
      longitude: result.longitude,
      akurasiGpsMeter: accuracy,
      jarakMeter: result.distance,
      radiusMeter: result.radius,
      titikReferensi: result.referenceName,
    }, auth.idUser);
  }

  return okResult({
    valid: result.valid,
    message: result.message,
    jarak: result.distance,
    radius: result.radius,
    sppg: auth.sppg,
    titikReferensi: result.referenceName,
  });
}

async function handleRecordAttendance(body: { function?: string; data?: Record<string, unknown> }): Promise<Response> {
  const data = body.data || {};
  const auth = await authenticateUser(data.token);
  const requestedId = String(data.idUser || auth.idUser);
  if (requestedId !== auth.idUser) {
    throw new Error("Akses ditolak. Identitas absensi tidak sesuai dengan sesi login.");
  }

  const result = await validateLocation(auth.sppg, data.lat, data.lng);
  const accuracy = data.accuracy == null ? null : Number(data.accuracy);
  if (!result.valid) {
    await writeAudit("ABSEN_MANDIRI_DITOLAK_LOKASI", {
      sppg: auth.sppg,
      latitude: result.latitude,
      longitude: result.longitude,
      akurasiGpsMeter: accuracy,
      jarakMeter: result.distance,
      radiusMeter: result.radius,
      titikReferensi: result.referenceName,
    }, auth.idUser);
    return okResult({ success: false, message: result.message });
  }

  const compatibility = coreCompatibilityPoint(auth.sppg, result.latitude!, result.longitude!);
  const forwardedBody = {
    ...body,
    data: {
      ...data,
      idUser: auth.idUser,
      lat: compatibility.lat,
      lng: compatibility.lng,
    },
  };

  const coreResponse = await fetch(CORE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(forwardedBody),
  });
  const responseText = await coreResponse.text();

  let payload: any = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    return new Response(responseText, {
      status: coreResponse.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (payload?.success && payload?.result?.success) {
    const { data: latest } = await supabase
      .from("Absensi")
      .select("ID_Absen")
      .eq("ID_User", auth.idUser)
      .eq("ID_Device", `SELF_${auth.idUser}`)
      .order("Waktu_Timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.ID_Absen) {
      const { error: updateError } = await supabase
        .from("Absensi")
        .update({
          Latitude: result.latitude,
          Longitude: result.longitude,
          Akurasi_GPS_Meter: Number.isFinite(accuracy) ? accuracy : null,
          Jarak_Lokasi_Meter: result.distance,
          Radius_Maksimum_Meter: result.radius,
          Lokasi_SPPG_Referensi: result.referenceName,
        })
        .eq("ID_Absen", latest.ID_Absen);
      if (updateError) console.error("Gagal menyimpan metadata GPS absensi", updateError.message);
    }

    await writeAudit("GEOFENCE_ABSEN_VALID", {
      sppg: auth.sppg,
      latitude: result.latitude,
      longitude: result.longitude,
      akurasiGpsMeter: accuracy,
      jarakMeter: result.distance,
      radiusMeter: result.radius,
      titikReferensi: result.referenceName,
    }, auth.idUser);
  }

  return new Response(JSON.stringify(payload), {
    status: coreResponse.status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errResult("Method tidak didukung. Gunakan POST.", 405);

  let body: { function?: string; data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return errResult("Body request harus berupa JSON valid.");
  }

  try {
    if (body.function === "checkAttendanceLocation") {
      return await handleLocationCheck(body.data || {});
    }
    if (body.function === "recordAbsensiSelf") {
      return await handleRecordAttendance(body);
    }
    return await forwardToCore(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Geofence gateway error (${body.function || "unknown"})`, error);
    return errResult(message);
  }
});
