import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type,x-idempotency-key',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const normalizeRole = (value: unknown) => String(value || '').trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
const isActive = (value: unknown) => value === true || value === 1 || ['TRUE', '1'].includes(String(value || '').toUpperCase());
const normalizeSppgKey = (value: unknown) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/^SPPG[\s_-]*/, '')
  .replace(/[^A-Z0-9]+/g, '');

interface AuthenticatedUser {
  ID_User: string;
  Nama_Lengkap: string;
  Email: string;
  Role: string;
  SPPG: string;
  token: string;
}

interface LocationPolicy {
  required: boolean;
  configured: boolean;
  key: string | null;
  source: 'SPPG' | 'DEFAULT' | 'DISABLED' | 'NONE';
  referenceName: string;
  latitude: number | null;
  longitude: number | null;
  radius: number | null;
  message: string;
}

interface LocationCheck extends LocationPolicy {
  valid: boolean;
  distance: number | null;
  actualLatitude: number | null;
  actualLongitude: number | null;
}

async function authenticate(tokenValue: unknown): Promise<AuthenticatedUser> {
  const token = String(tokenValue || '').trim();
  if (!token) throw new Error('SESI_HABIS');

  const { data: session, error: sessionError } = await db.from('Sessions')
    .select('ID_User,Type,Expires_At')
    .eq('Token', token)
    .maybeSingle();
  if (
    sessionError || !session?.ID_User || String(session.Type || '').toLowerCase() !== 'user' ||
    new Date(session.Expires_At).getTime() <= Date.now()
  ) throw new Error('SESI_HABIS');

  const { data: user, error: userError } = await db.from('Users')
    .select('ID_User,Nama_Lengkap,Email,Role,SPPG,Status_Aktif')
    .eq('ID_User', session.ID_User)
    .maybeSingle();
  if (userError || !user || !isActive(user.Status_Aktif)) throw new Error('AKUN_NONAKTIF');

  return {
    ID_User: String(user.ID_User),
    Nama_Lengkap: String(user.Nama_Lengkap || ''),
    Email: String(user.Email || ''),
    Role: normalizeRole(user.Role),
    SPPG: String(user.SPPG || ''),
    token,
  };
}

async function geofenceRequired(): Promise<boolean> {
  const { data, error } = await db.from('System_Settings')
    .select('Setting_Value')
    .eq('Setting_Key', 'attendance.geofence_required')
    .maybeSingle();
  if (error) throw new Error('Gagal membaca kebijakan geofence: ' + error.message);
  return data?.Setting_Value?.enabled !== false;
}

async function resolveLocationPolicy(sppg: string): Promise<LocationPolicy> {
  if (!(await geofenceRequired())) {
    return {
      required: false,
      configured: true,
      key: null,
      source: 'DISABLED',
      referenceName: 'Geofence dinonaktifkan',
      latitude: null,
      longitude: null,
      radius: null,
      message: 'Geofence sedang dinonaktifkan oleh SUPER ADMIN.',
    };
  }

  const key = normalizeSppgKey(sppg);
  const keys = [...new Set([key, 'DEFAULT'].filter(Boolean))];
  const { data: rows, error } = await db.from('Lokasi_SPPG')
    .select('Kunci_SPPG,Nama_SPPG,Latitude,Longitude,Radius_Meter,Aktif,Updated_At')
    .in('Kunci_SPPG', keys);
  if (error) throw new Error('Gagal membaca lokasi SPPG: ' + error.message);

  const exact = (rows || []).find((row: any) => row.Kunci_SPPG === key && isActive(row.Aktif));
  const fallback = (rows || []).find((row: any) => row.Kunci_SPPG === 'DEFAULT' && isActive(row.Aktif));
  const reference: any = exact || fallback;
  if (!reference) {
    return {
      required: true,
      configured: false,
      key: null,
      source: 'NONE',
      referenceName: sppg || 'SPPG',
      latitude: null,
      longitude: null,
      radius: null,
      message: `Lokasi aktif untuk ${sppg || 'SPPG pengguna'} belum diatur oleh SUPER ADMIN.`,
    };
  }

  const latitude = Number(reference.Latitude);
  const longitude = Number(reference.Longitude);
  const radius = Math.round(Number(reference.Radius_Meter));
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    !Number.isFinite(radius) || radius < 1
  ) {
    return {
      required: true,
      configured: false,
      key: String(reference.Kunci_SPPG || ''),
      source: reference.Kunci_SPPG === 'DEFAULT' ? 'DEFAULT' : 'SPPG',
      referenceName: String(reference.Nama_SPPG || sppg || 'SPPG'),
      latitude: null,
      longitude: null,
      radius: null,
      message: 'Konfigurasi latitude, longitude, atau radius di backend tidak valid.',
    };
  }

  return {
    required: true,
    configured: true,
    key: String(reference.Kunci_SPPG),
    source: reference.Kunci_SPPG === 'DEFAULT' ? 'DEFAULT' : 'SPPG',
    referenceName: String(reference.Nama_SPPG || reference.Kunci_SPPG),
    latitude,
    longitude,
    radius,
    message: reference.Kunci_SPPG === 'DEFAULT'
      ? 'Menggunakan titik cadangan yang diatur SUPER ADMIN.'
      : 'Menggunakan titik SPPG yang diatur SUPER ADMIN.',
  };
}

function distanceMeter(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadius = 6_371_000;
  const toRad = (degree: number) => degree * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function checkLocation(sppg: string, rawLat: unknown, rawLng: unknown): Promise<LocationCheck> {
  const policy = await resolveLocationPolicy(sppg);
  if (!policy.required) {
    return { ...policy, valid: true, distance: null, actualLatitude: null, actualLongitude: null };
  }
  if (!policy.configured) {
    return { ...policy, valid: false, distance: null, actualLatitude: null, actualLongitude: null };
  }

  const latitude = Number(rawLat);
  const longitude = Number(rawLng);
  if (
    rawLat === null || rawLat === undefined || rawLng === null || rawLng === undefined ||
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    return {
      ...policy,
      valid: false,
      distance: null,
      actualLatitude: null,
      actualLongitude: null,
      message: 'Lokasi GPS tidak valid atau belum tersedia.',
    };
  }

  const distance = Math.round(distanceMeter(policy.latitude!, policy.longitude!, latitude, longitude));
  const valid = distance <= policy.radius!;
  return {
    ...policy,
    valid,
    distance,
    actualLatitude: latitude,
    actualLongitude: longitude,
    message: valid
      ? `Lokasi valid. Jarak ${distance} meter dari ${policy.referenceName}.`
      : `Anda berada di luar radius ${policy.referenceName} (jarak ${distance} meter, maksimal ${policy.radius} meter).`,
  };
}

function parseFaceDescriptor(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(Number) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function faceScore(reference: number[] | null, scan: unknown): number {
  if (!reference || !Array.isArray(scan) || reference.length !== scan.length || !reference.length) return 0;
  let sumSquare = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const expected = Number(reference[index]);
    const actual = Number(scan[index]);
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) return 0;
    sumSquare += (expected - actual) ** 2;
  }
  return (1 - Math.sqrt(sumSquare)) * 100;
}

function jakartaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function jakartaTime(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
}

async function audit(type: string, detail: Record<string, unknown>, actor: string): Promise<void> {
  const { error } = await db.from('Audit_Log').insert({
    ID_Log: `AUDIT_ATT_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    Waktu: new Date().toISOString(),
    ID_User_Pelaku: actor,
    Jenis_Aktivitas: type,
    Detail: detail,
    IP_Address: null,
  });
  if (error) console.error('AttendanceLocation audit failed', error.message);
}

async function acquireLock(idUser: string): Promise<boolean> {
  const { data, error } = await db.rpc('acquire_absen_lock_v1', {
    p_user_id: idUser,
    p_ttl_seconds: 20,
  });
  if (error) throw new Error('Gagal mengunci proses absensi: ' + error.message);
  return Boolean(data);
}

async function releaseLock(idUser: string): Promise<void> {
  const { error } = await db.from('Absen_Locks').delete().eq('ID_User', idUser);
  if (error) console.error('AttendanceLocation lock release failed', error.message);
}

async function recordAttendance(user: AuthenticatedUser, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const targetId = String(data.idUser || user.ID_User);
  if (targetId !== user.ID_User) throw new Error('Akses ditolak. Identitas absensi tidak sesuai dengan sesi login.');

  const [{ data: account, error: accountError }, facePolicy] = await Promise.all([
    db.from('Users')
      .select('ID_User,Nama_Lengkap,SPPG,Status_Aktif,Face_Descriptor_JSON')
      .eq('ID_User', user.ID_User)
      .maybeSingle(),
    db.rpc('is_face_attendance_enabled', { p_user_id: user.ID_User }),
  ]);
  if (accountError || !account || !isActive(account.Status_Aktif)) throw new Error('AKUN_NONAKTIF');
  if (facePolicy.error) throw new Error('Gagal membaca kebijakan scan wajah: ' + facePolicy.error.message);
  if (facePolicy.data === false) {
    return { success: false, message: 'Absensi dengan scan wajah sedang dinonaktifkan untuk akun atau SPPG ini.' };
  }

  const reference = parseFaceDescriptor(account.Face_Descriptor_JSON);
  if (!reference) {
    return { success: false, message: 'Data wajah referensi belum terdaftar. Perbarui wajah melalui menu Profil.' };
  }
  const score = faceScore(reference, data.faceDescriptorScan);
  if (score < 70) {
    await audit('ABSEN_MANDIRI_DITOLAK_SKOR', { idUser: user.ID_User, score }, user.ID_User);
    return { success: false, message: 'Wajah tidak dikenali dengan cukup akurat. Silakan coba lagi.' };
  }

  const location = await checkLocation(String(account.SPPG || user.SPPG), data.lat, data.lng);
  if (!location.valid) {
    await audit('ABSEN_MANDIRI_DITOLAK_LOKASI', {
      idUser: user.ID_User,
      sppg: account.SPPG,
      distance: location.distance,
      radius: location.radius,
      reference: location.referenceName,
      source: location.source,
    }, user.ID_User);
    return { success: false, message: location.message };
  }

  if (!(await acquireLock(user.ID_User))) {
    return { success: false, message: 'Absen Anda sedang diproses, mohon tunggu sebentar.' };
  }

  try {
    const day = jakartaDate();
    const { data: punches, error: punchesError } = await db.from('Absensi')
      .select('Jenis_Absen,Status_Validasi')
      .eq('ID_User', user.ID_User)
      .eq('Tanggal', day);
    if (punchesError) throw new Error('Gagal memeriksa absensi hari ini: ' + punchesError.message);

    const hasArrival = (punches || []).some((row: any) => row.Jenis_Absen === 'DATANG' && row.Status_Validasi === 'VALID');
    const hasDeparture = (punches || []).some((row: any) => row.Jenis_Absen === 'PULANG' && row.Status_Validasi === 'VALID');
    const type = !hasArrival ? 'DATANG' : !hasDeparture ? 'PULANG' : '';
    if (!type) return { success: false, message: 'Anda sudah absen Datang & Pulang hari ini.' };

    const id = `ABS_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const accuracy = Number(data.accuracy);
    const { error: insertError } = await db.from('Absensi').insert({
      ID_Absen: id,
      ID_User: user.ID_User,
      Tanggal: day,
      Jenis_Absen: type,
      Waktu_Timestamp: new Date().toISOString(),
      ID_Device: `SELF_${user.ID_User}`,
      Skor_Kecocokan_Wajah: score,
      Status_Validasi: 'VALID',
      SPPG: account.SPPG,
      ID_Payroll: '',
      Latitude: location.actualLatitude,
      Longitude: location.actualLongitude,
      Akurasi_GPS_Meter: Number.isFinite(accuracy) ? accuracy : null,
      Jarak_Lokasi_Meter: location.distance,
      Radius_Maksimum_Meter: location.radius,
      Lokasi_SPPG_Referensi: location.required ? location.referenceName : 'GEOFENCE_NONAKTIF',
    });
    if (insertError) throw new Error('Gagal menyimpan absensi: ' + insertError.message);

    await audit('ABSEN_MANDIRI_BERHASIL', {
      idAbsen: id,
      idUser: user.ID_User,
      type,
      score,
      sppg: account.SPPG,
      distance: location.distance,
      radius: location.radius,
      reference: location.referenceName,
      source: location.source,
    }, user.ID_User);

    return { success: true, message: type, nama: account.Nama_Lengkap, waktu: jakartaTime() };
  } finally {
    await releaseLock(user.ID_User);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ success: false, message: 'Method tidak didukung.' }, 405);

  try {
    const body = await request.json();
    const action = String(body.action || '').trim();
    const user = await authenticate(body.token);

    if (action === 'policy') {
      const policy = await resolveLocationPolicy(user.SPPG);
      return json({ success: true, result: {
        required: policy.required,
        configured: policy.configured,
        source: policy.source,
        referenceName: policy.referenceName,
        radius: policy.radius,
        message: policy.message,
      } });
    }

    if (action === 'check') {
      const result = await checkLocation(user.SPPG, body.lat, body.lng);
      if (!result.valid) {
        await audit('CEK_LOKASI_ABSEN_DITOLAK', {
          sppg: user.SPPG,
          distance: result.distance,
          radius: result.radius,
          reference: result.referenceName,
          source: result.source,
        }, user.ID_User);
      }
      return json({ success: true, result: {
        valid: result.valid,
        message: result.message,
        distance: result.distance,
        jarak: result.distance,
        radius: result.radius,
        sppg: user.SPPG,
        referenceName: result.referenceName,
        titikReferensi: result.referenceName,
        geofenceRequired: result.required,
        configured: result.configured,
        source: result.source,
      } });
    }

    if (action === 'record') {
      return json({ success: true, result: await recordAttendance(user, body) });
    }

    throw new Error('Aksi lokasi absensi tidak dikenali.');
  } catch (error) {
    console.error('AttendanceLocation error', error);
    return json({ success: false, message: error instanceof Error ? error.message : 'Terjadi kesalahan.' }, 400);
  }
});
