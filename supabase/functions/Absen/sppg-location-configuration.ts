import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const MAX_RADIUS_METER = 100;
const DEFAULT_LOCATION_KEY = "DEFAULT";

type HandlerResult =
  | { handled: false }
  | { handled: true; result: unknown };

interface SuperAdminIdentity {
  idUser: string;
  email: string;
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

function finiteCoordinate(value: unknown, min: number, max: number, label: string): number {
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
    throw new Error(`${label} tidak valid.`);
  }
  return coordinate;
}

async function requireSuperAdmin(
  token: unknown,
  supabase: SupabaseClient,
): Promise<SuperAdminIdentity> {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) throw new Error("SESI_HABIS");

  const { data: session, error: sessionError } = await supabase
    .from("Sessions")
    .select("ID_User, Type, Expires_At")
    .eq("Token", cleanToken)
    .maybeSingle();
  if (
    sessionError || !session || !session.ID_User ||
    String(session.Type || "").toLowerCase() !== "user" ||
    new Date(session.Expires_At).getTime() < Date.now()
  ) {
    throw new Error("SESI_HABIS");
  }

  const { data: user, error: userError } = await supabase
    .from("Users")
    .select("ID_User, Email, Role, Status_Aktif")
    .eq("ID_User", session.ID_User)
    .maybeSingle();
  if (userError || !user || !isActive(user.Status_Aktif)) {
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

async function getConfiguration(
  data: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<unknown> {
  await requireSuperAdmin(data.token, supabase);

  const [masterResult, locationResult] = await Promise.all([
    supabase
      .from("Master_SPPG")
      .select("Nama_SPPG, Yayasan, Aktif")
      .order("Nama_SPPG", { ascending: true }),
    supabase
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
    masterSppg: (masterResult.data || []).filter((row: any) => isActive(row.Aktif)),
    locations: locationResult.data || [],
  };
}

async function saveConfiguration(
  data: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<unknown> {
  const actor = await requireSuperAdmin(data.token, supabase);

  const requestedKey = String(data.kunciSppg || "").trim().toUpperCase();
  const requestedName = String(data.namaSppg || "").trim();
  const key = requestedKey === DEFAULT_LOCATION_KEY
    ? DEFAULT_LOCATION_KEY
    : normalizeSppgKey(requestedKey || requestedName);
  if (!key || !/^[A-Z0-9]{2,80}$/.test(key)) {
    throw new Error("SPPG belum dipilih atau kunci SPPG tidak valid.");
  }

  const latitude = finiteCoordinate(data.latitude, -90, 90, "Latitude");
  const longitude = finiteCoordinate(data.longitude, -180, 180, "Longitude");
  const radius = Math.round(Number(data.radiusMeter));
  if (!Number.isFinite(radius) || radius < 1 || radius > MAX_RADIUS_METER) {
    throw new Error(`Radius harus antara 1 sampai ${MAX_RADIUS_METER} meter.`);
  }

  const catatan = String(data.catatan || "").trim().slice(0, 500);
  const aktif = data.aktif !== false && String(data.aktif).toLowerCase() !== "false";

  const [existingResult, masterResult] = await Promise.all([
    supabase
      .from("Lokasi_SPPG")
      .select("Kunci_SPPG, Nama_SPPG, Latitude, Longitude, Radius_Meter, Aktif, Catatan")
      .eq("Kunci_SPPG", key)
      .maybeSingle(),
    supabase
      .from("Master_SPPG")
      .select("Nama_SPPG, Yayasan, Aktif"),
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
    const master = (masterResult.data || []).find((row: any) =>
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

  const { data: saved, error: saveError } = await supabase
    .from("Lokasi_SPPG")
    .upsert(payload, { onConflict: "Kunci_SPPG" })
    .select("Kunci_SPPG, Nama_SPPG, Latitude, Longitude, Radius_Meter, Aktif, Catatan, Updated_At")
    .single();
  if (saveError) {
    throw new Error("Gagal menyimpan konfigurasi lokasi SPPG: " + saveError.message);
  }

  const auditDetail = {
    actorEmail: actor.email,
    kunciSppg: key,
    before: existingResult.data || null,
    after: saved,
  };
  const { error: auditError } = await supabase.from("Audit_Log").insert({
    ID_Log: `AUDIT_LOC_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    Waktu: new Date().toISOString(),
    ID_User_Pelaku: actor.idUser,
    Jenis_Aktivitas: "UPDATE_LOKASI_SPPG",
    Detail: auditDetail,
    IP_Address: null,
  });
  if (auditError) {
    console.error("Gagal menyimpan audit konfigurasi lokasi SPPG", auditError.message);
  }

  return {
    message: `Lokasi ${canonicalName} berhasil diperbarui.`,
    location: saved,
  };
}

export async function handleSppgLocationConfiguration(
  functionName: string | undefined,
  data: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<HandlerResult> {
  if (functionName === "getSppgLocationConfiguration") {
    return { handled: true, result: await getConfiguration(data, supabase) };
  }
  if (functionName === "saveSppgLocationConfiguration") {
    return { handled: true, result: await saveConfiguration(data, supabase) };
  }
  return { handled: false };
}
