import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const LEGACY_CORE_URL = `${SUPABASE_URL}/functions/v1/AbsenCore`;
const ATTENDANCE_LOCATION_URL = `${SUPABASE_URL}/functions/v1/AttendanceLocation`;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type,x-idempotency-key',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

const json = (body: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers, ...(requestId ? { 'x-request-id': requestId } : {}) },
});
const normalize = (value: unknown) => String(value || '').trim().toUpperCase().replace(/_/g, ' ');
const isActive = (value: unknown) => value === true || value === 1 || ['TRUE', '1'].includes(String(value || '').toUpperCase());
const numeric = (value: unknown) => Number(value || 0);

async function authenticate(tokenValue: unknown) {
  const token = String(tokenValue || '').trim();
  if (!token) throw new Error('SESI_HABIS');

  const { data: session, error: sessionError } = await db.from('Sessions')
    .select('ID_User,Type,Expires_At')
    .eq('Token', token)
    .maybeSingle();
  if (sessionError || !session || String(session.Type).toLowerCase() !== 'user' || new Date(session.Expires_At).getTime() <= Date.now()) {
    throw new Error('SESI_HABIS');
  }

  const { data: user, error: userError } = await db.from('Users')
    .select('ID_User,Email,Role,SPPG,Status_Aktif,Nama_Lengkap')
    .eq('ID_User', session.ID_User)
    .maybeSingle();
  if (userError || !user || !isActive(user.Status_Aktif)) throw new Error('AKUN_NONAKTIF');
  return { ...user, role: normalize(user.Role), token };
}

async function allRows(table: string, columns = '*', filter?: (query: any) => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    let query = db.from(table).select(columns).range(from, from + 999);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return rows;
}

async function scopedUserIds(user: any) {
  if (user.role === 'USER') return [String(user.ID_User)];
  if (user.role === 'SUPER ADMIN') {
    const users = await allRows('Users', 'ID_User,Role,Status_Aktif');
    return users
      .filter((row: any) => normalize(row.Role) === 'USER' && isActive(row.Status_Aktif))
      .map((row: any) => String(row.ID_User));
  }

  const { data: accessRows, error } = await db.from('Akses_Email')
    .select('SPPG,Aktif')
    .ilike('Email', String(user.Email || ''));
  if (error) throw error;
  const sppg = [...new Set((accessRows || [])
    .filter((row: any) => isActive(row.Aktif))
    .map((row: any) => String(row.SPPG || '').trim())
    .filter(Boolean))];
  if (!sppg.length && user.SPPG) sppg.push(String(user.SPPG));
  if (!sppg.length) return [];

  const users = await allRows('Users', 'ID_User,Role,Status_Aktif,SPPG', (query) => query.in('SPPG', sppg));
  return users
    .filter((row: any) => normalize(row.Role) === 'USER' && isActive(row.Status_Aktif))
    .map((row: any) => String(row.ID_User));
}

async function forward(url: string, body: unknown, request: Request) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      ...(request.headers.get('x-idempotency-key')
        ? { 'x-idempotency-key': request.headers.get('x-idempotency-key')! }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    payload: (() => {
      try { return JSON.parse(text); } catch { return null; }
    })(),
  };
}

function mappedError(rawValue: unknown, fallbackStatus = 500) {
  const raw = String(rawValue || '').trim();
  const upper = raw.toUpperCase();
  if (upper.includes('SESI_HABIS') || upper.includes('SESSION_EXPIRED')) {
    return { status: 401, code: 'SESSION_EXPIRED', message: 'Sesi telah berakhir. Silakan login kembali.' };
  }
  if (upper.includes('AKUN_NONAKTIF') || upper.includes('ACCOUNT_INACTIVE')) {
    return { status: 403, code: 'ACCOUNT_INACTIVE', message: 'Akun tidak aktif.' };
  }
  if (/akses ditolak|hanya untuk/i.test(raw)) return { status: 403, code: 'FORBIDDEN', message: raw || 'Akses ditolak.' };
  if (/tidak ditemukan/i.test(raw)) return { status: 404, code: 'NOT_FOUND', message: raw };
  if (/duplicate|sudah .*hari ini|sudah digunakan|sudah diproses|tidak dapat diubah/i.test(raw)) return { status: 409, code: 'CONFLICT', message: raw };
  if (/wajib|tidak valid|tidak lengkap|format|harus|minimal|maksimal|tidak dikenali|tidak didukung/i.test(raw)) {
    return { status: 422, code: 'VALIDATION_ERROR', message: raw || 'Permintaan tidak valid.' };
  }
  return { status: fallbackStatus >= 400 && fallbackStatus < 500 ? fallbackStatus : 500, code: 'INTERNAL_ERROR', message: fallbackStatus >= 400 && fallbackStatus < 500 && raw ? raw : 'Terjadi kesalahan pada server.' };
}

function legacyFailure(result: { status: number; payload: any }) {
  if (!result.payload) return null;
  const nested = result.payload?.success === true && result.payload?.result && typeof result.payload.result === 'object' && result.payload.result.success === false
    ? result.payload.result
    : null;
  if (result.payload?.success !== false && !nested) return null;
  const source = nested || result.payload;
  const raw = source?.message || source?.error || source?.code || 'Permintaan gagal diproses.';
  const mapped = mappedError(raw, result.status);
  return {
    status: mapped.status,
    body: {
      success: false,
      code: mapped.code,
      message: mapped.message,
      error: source?.error || mapped.message,
    },
  };
}

function forwardResponse(result: { status: number; text: string; payload: any }, requestId: string) {
  const failure = legacyFailure(result);
  if (failure) return json({ ...failure.body, requestId }, failure.status, requestId);
  if (!result.payload) return new Response(result.text, { status: result.status, headers: { ...headers, 'x-request-id': requestId } });
  const status = result.status >= 200 && result.status < 300 ? result.status : 500;
  return json({ ...result.payload, requestId }, status, requestId);
}

async function forwardLocation(body: any, request: Request, requestId: string): Promise<Response | null> {
  const functionName = String(body.function || body.functionName || '');
  const actions: Record<string, string> = {
    getAttendanceLocationPolicy: 'policy',
    checkAttendanceLocation: 'check',
    recordAbsensiSelf: 'record',
  };
  const action = actions[functionName];
  if (!action) return null;

  const data = body.data || body;
  const result = await forward(ATTENDANCE_LOCATION_URL, {
    ...data,
    action,
    token: data.token,
  }, request);
  return forwardResponse(result, requestId);
}

async function optimizedMyAttendance(user: any, data: any) {
  const month = String(data?.filterBulan || '').trim();
  if (month && !/^\d{4}-\d{2}$/.test(month)) throw new Error('Filter bulan tidak valid.');
  const result = await db.rpc('get_my_absensi_grouped', { p_user_id: user.ID_User, p_month: month || null });
  if (result.error) throw new Error(`ATTENDANCE_QUERY_FAILED:${result.error.message}`);
  return result.data || { rows: [], totalHariKerja: 0, totalDatang: 0, totalPulang: 0 };
}
async function optimizedUserDashboard(user: any) {
  const result = await db.rpc('get_user_dashboard_summary', { p_user_id: user.ID_User });
  if (result.error) throw new Error(`DASHBOARD_QUERY_FAILED:${result.error.message}`);
  return result.data || { role: 'USER', totalHariKerja: 0, totalSlip: 0, totalGajiDiterima: 0, riwayat: [], sudahDatang: false, sudahPulang: false };
}
async function optimizedAuditLog(user: any, data: any) {
  if (!['ADMIN', 'SUPER ADMIN'].includes(user.role)) throw new Error('Akses hanya untuk ADMIN');
  const limit = Math.min(500, Math.max(1, Number(data?.limit) || 100));
  const result = await db.from('Audit_Log')
    .select('ID_Log,Waktu,ID_User_Pelaku,Jenis_Aktivitas,Detail,IP_Address')
    .order('Waktu', { ascending: false })
    .limit(limit);
  if (result.error) throw result.error;
  let logs = result.data || [];
  const filters = data?.filters || {};
  if (filters.jenisAktivitas) logs = logs.filter((row: any) => row.Jenis_Aktivitas === filters.jenisAktivitas);
  if (filters.tanggal) logs = logs.filter((row: any) => String(row.Waktu || '').slice(0, 10) === String(filters.tanggal).slice(0, 10));
  if (filters.pelaku) logs = logs.filter((row: any) => row.ID_User_Pelaku === filters.pelaku);
  const actorIds = [...new Set(logs.map((row: any) => String(row.ID_User_Pelaku || '')).filter((id: string) => id && id !== 'SYSTEM'))];
  let actors = new Map<string, any>();
  if (actorIds.length) {
    const actorRows = await db.from('Users').select('ID_User,Nama_Lengkap,Email').in('ID_User', actorIds);
    if (actorRows.error) throw actorRows.error;
    actors = new Map((actorRows.data || []).map((row: any) => [String(row.ID_User), row]));
  }
  return { logs: logs.map((row: any) => {
    const actor = actors.get(String(row.ID_User_Pelaku));
    return { ...row, _pelakuNama: actor?.Nama_Lengkap || (row.ID_User_Pelaku === 'SYSTEM' ? 'Sistem' : row.ID_User_Pelaku), _pelakuEmail: actor?.Email || '' };
  }) };
}

async function optimizedSlipList(user: any) {
  if (!['ADMIN', 'SUPER ADMIN', 'AKUNTAN'].includes(user.role)) throw new Error('Akses hanya untuk ADMIN atau AKUNTAN');
  const ids = user.role === 'SUPER ADMIN' ? null : await scopedUserIds(user);
  if (ids && !ids.length) return { slipGaji: [] };
  let query = db.from('Slip_Gaji')
    .select('ID_Slip,ID_Payroll,ID_User,Periode_Mulai,Periode_Akhir,Total_Gaji_Diterima,Status_Penerbitan,Diterbitkan_At,Created_At,PDF_Storage_Path,URL_PDF_Slip,SPPG')
    .order('Diterbitkan_At', { ascending: false, nullsFirst: false });
  if (ids) query = query.in('ID_User', ids);
  const slips = await query;
  if (slips.error) throw slips.error;
  const userIds = [...new Set((slips.data || []).map((row: any) => String(row.ID_User || '')).filter(Boolean))];
  let users = new Map<string, any>();
  if (userIds.length) {
    const userRows = await db.from('Users').select('ID_User,Nama_Lengkap,SPPG').in('ID_User', userIds);
    if (userRows.error) throw userRows.error;
    users = new Map((userRows.data || []).map((row: any) => [String(row.ID_User), row]));
  }
  return { slipGaji: (slips.data || []).map((row: any) => {
    const employee = users.get(String(row.ID_User));
    return { ...row, _namaKaryawan: employee?.Nama_Lengkap || row.ID_User, _sppgKaryawan: employee?.SPPG || row.SPPG || '' };
  }) };
}

function notificationMatches(notification: any, user: any) {
  const mode = String(notification.Target_Mode || 'ALL').toUpperCase();
  if (mode === 'ALL') return true;
  if (mode === 'ROLES') return (notification.Target_Roles || []).map(normalize).includes(user.role);
  if (mode === 'SPPG') return (notification.Target_SPPG || []).map(String).includes(String(user.SPPG || ''));
  if (mode === 'USERS') return (notification.Target_User_IDs || []).map(String).includes(String(user.ID_User));
  return false;
}

async function appNotifications(user: any) {
  const now = new Date().toISOString();
  const { data: notifications, error } = await db.from('App_Notifications')
    .select('ID_Notification,Title,Message,Priority,Target_Mode,Target_Roles,Target_SPPG,Target_User_IDs,Show_Banner,Play_Sound,Push_Enabled,Action_View,Starts_At,Expires_At,Created_At,Status')
    .eq('Status', 'PUBLISHED')
    .lte('Starts_At', now)
    .or(`Expires_At.is.null,Expires_At.gt.${now}`)
    .order('Created_At', { ascending: false })
    .limit(100);
  if (error) throw error;

  const matched = (notifications || []).filter((item: any) => notificationMatches(item, user));
  const ids = matched.map((item: any) => item.ID_Notification);
  let read = new Set<string>();
  if (ids.length) {
    const result = await db.from('App_Notification_Read')
      .select('ID_Notification')
      .eq('ID_User', user.ID_User)
      .in('ID_Notification', ids);
    if (result.error) throw result.error;
    read = new Set((result.data || []).map((row: any) => String(row.ID_Notification)));
  }

  return matched
    .filter((item: any) => !read.has(String(item.ID_Notification)))
    .map((item: any) => ({
      id: `APP:${item.ID_Notification}`,
      type: 'PENGUMUMAN',
      title: item.Title,
      message: item.Message,
      actionView: item.Action_View || 'dashboard',
      timestamp: item.Created_At,
      priority: item.Priority || 'NORMAL',
      showBanner: Boolean(item.Show_Banner),
      playSound: Boolean(item.Play_Sound),
      pushEnabled: Boolean(item.Push_Enabled),
      notificationId: item.ID_Notification,
    }));
}

function jakartaDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function superAdminOverview(user: any) {
  if (user.role !== 'SUPER ADMIN') throw new Error('Akses hanya untuk SUPER ADMIN');
  const day = jakartaDate();
  const [users, masters, attendance, slips, complaints, sessions, settings] = await Promise.all([
    allRows('Users', 'ID_User,Nama_Lengkap,Role,Status_Aktif,SPPG,Jabatan_Divisi,Gaji_Harian,Nama_Bank,Nomor_Rekening'),
    allRows('Master_SPPG', 'Nama_SPPG,Aktif'),
    allRows('Absensi', 'ID_User,Tanggal,Jenis_Absen,SPPG', (query) => query.eq('Tanggal', day)),
    allRows('Slip_Gaji', 'ID_Slip,ID_User,SPPG,Total_Gaji_Diterima,Status_Penerbitan,PDF_Storage_Path'),
    allRows('Pengaduan', 'ID_Pengaduan,SPPG,Status_Tiket'),
    allRows('Sessions', 'ID_User,Expires_At'),
    allRows('System_Settings', 'Setting_Key,Setting_Value,Description,Updated_At,Updated_By'),
  ]);

  const activeUsers = users.filter((row: any) => isActive(row.Status_Aktif) && normalize(row.Role) === 'USER');
  const admins = users.filter((row: any) => isActive(row.Status_Aktif) && ['ADMIN', 'AKUNTAN'].includes(normalize(row.Role)));
  const names = [...new Set([
    ...masters.filter((row: any) => isActive(row.Aktif)).map((row: any) => String(row.Nama_SPPG || '').trim()),
    ...activeUsers.map((row: any) => String(row.SPPG || '').trim()),
  ].filter(Boolean))].sort();

  const bySppg = names.map((sppg) => {
    const sppgUsers = activeUsers.filter((row: any) => String(row.SPPG || '') === sppg);
    const userIds = new Set(sppgUsers.map((row: any) => String(row.ID_User)));
    const sppgAttendance = attendance.filter((row: any) => userIds.has(String(row.ID_User)));
    const present = new Set(sppgAttendance.map((row: any) => String(row.ID_User)));
    const types = new Map<string, Set<string>>();
    sppgAttendance.forEach((row: any) => {
      const id = String(row.ID_User);
      const set = types.get(id) || new Set<string>();
      set.add(normalize(row.Jenis_Absen));
      types.set(id, set);
    });
    const complete = [...types.values()].filter((set) => set.has('DATANG') && set.has('PULANG')).length;
    const sppgSlips = slips.filter((row: any) => String(row.SPPG || '') === sppg);
    const openComplaints = complaints.filter((row: any) =>
      String(row.SPPG || '') === sppg && !['SELESAI', 'DITUTUP', 'CLOSED'].includes(normalize(row.Status_Tiket)));
    return {
      sppg,
      employees: sppgUsers.length,
      attendanceRate: sppgUsers.length ? Math.round(present.size * 100 / sppgUsers.length) : 0,
      completePunchRate: sppgUsers.length ? Math.round(complete * 100 / sppgUsers.length) : 0,
      payrollTotal: sppgSlips.reduce((total: number, row: any) => total + numeric(row.Total_Gaji_Diterima), 0),
      pendingSlips: sppgSlips.filter((row: any) => normalize(row.Status_Penerbitan) === 'MENUNGGU TTD PENERIMA').length,
      openComplaints: openComplaints.length,
    };
  });

  const presentAll = new Set(attendance
    .map((row: any) => String(row.ID_User))
    .filter((id: string) => activeUsers.some((row: any) => String(row.ID_User) === id)));
  const duplicateNames = new Map<string, any[]>();
  activeUsers.forEach((row: any) => {
    const key = String(row.Nama_Lengkap || '').trim().toUpperCase();
    if (!key) return;
    const current = duplicateNames.get(key) || [];
    current.push(row);
    duplicateNames.set(key, current);
  });
  const live = new Set(sessions
    .filter((row: any) => new Date(row.Expires_At).getTime() > Date.now())
    .map((row: any) => String(row.ID_User)));

  return {
    totals: {
      sppg: names.length,
      attendanceRate: activeUsers.length ? Math.round(presentAll.size * 100 / activeUsers.length) : 0,
      payrollTotal: slips.reduce((total: number, row: any) => total + numeric(row.Total_Gaji_Diterima), 0),
      admins: admins.length,
    },
    bySppg,
    quality: {
      duplicateNames: [...duplicateNames.values()].filter((rows) => rows.length > 1).flat(),
      withoutDivision: activeUsers.filter((row: any) => !String(row.Jabatan_Divisi || '').trim()),
      withoutSalary: activeUsers.filter((row: any) => numeric(row.Gaji_Harian) <= 0),
      withoutBank: activeUsers.filter((row: any) => !String(row.Nama_Bank || '').trim() || !String(row.Nomor_Rekening || '').trim()),
      slipsWithoutPdf: slips.filter((row: any) => !String(row.PDF_Storage_Path || '').trim()),
      inactiveWithSession: users.filter((row: any) => !isActive(row.Status_Aktif) && live.has(String(row.ID_User))),
    },
    settings,
  };
}

Deno.serve(async (request) => {
  const requestId = `ABS_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Method tidak didukung', requestId }, 405, requestId);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, code: 'INVALID_JSON', message: 'Body JSON tidak valid', requestId }, 400, requestId);
  }

  const functionName = String(body.function || body.functionName || '').trim();
  if (!functionName) {
    return json({ success: false, code: 'FUNCTION_REQUIRED', message: 'Nama fungsi wajib diisi.', requestId }, 422, requestId);
  }

  try {
    const locationResponse = await forwardLocation(body, request, requestId);
    if (locationResponse) return locationResponse;

    if (functionName === 'getAuditLogEnriched') {
    const user = await authenticate(body.data?.token);
    return json({ success: true, result: await optimizedAuditLog(user, body.data || {}), requestId }, 200, requestId);
  }
  if (functionName === 'getAllSlipGajiList') {
    const user = await authenticate(body.data?.token);
    return json({ success: true, result: await optimizedSlipList(user), requestId }, 200, requestId);
  }

  if (functionName === 'getMyAbsensi') {
    const user = await authenticate(body.data?.token);
    return json({ success: true, result: await optimizedMyAttendance(user, body.data || {}), requestId }, 200, requestId);
  }
  if (functionName === 'getDashboardData') {
    const user = await authenticate(body.data?.token);
    if (user.role === 'USER') return json({ success: true, result: await optimizedUserDashboard(user), requestId }, 200, requestId);
    const legacyDashboard = await forward(LEGACY_CORE_URL, body, request);
    return forwardResponse(legacyDashboard, requestId);
  }
  if (functionName === 'getSuperAdminOverviewV3') {
      const user = await authenticate(body.data?.token);
      return json({ success: true, result: await superAdminOverview(user), requestId }, 200, requestId);
    }

    if (functionName === 'getUserNotificationsV2') {
      const user = await authenticate(body.data?.token);
      const legacy = await forward(LEGACY_CORE_URL, body, request);
      const failure = legacyFailure(legacy);
      if (failure) return json({ ...failure.body, requestId }, failure.status, requestId);
      if (!legacy.payload) throw new Error('Respons backend notifikasi tidak valid.');
      const base = legacy.payload?.result || {};
      const nonGenerated = (Array.isArray(base.items) ? base.items : [])
        .filter((item: any) => item?.type !== 'PAYROLL' && item?.type !== 'PENGUMUMAN');
      const { data: slips, error } = await db.from('Slip_Gaji')
        .select('ID_Slip,Periode_Mulai,Periode_Akhir,Diterbitkan_At')
        .eq('ID_User', user.ID_User)
        .eq('Status_Penerbitan', 'MENUNGGU_TTD_PENERIMA')
        .order('Diterbitkan_At', { ascending: false });
      if (error) throw error;
      const payroll = (slips || []).map((row: any) => ({
        id: `SLIP:${row.ID_Slip}`,
        type: 'PAYROLL',
        title: 'Slip gaji menunggu tanda tangan',
        message: `Periode ${row.Periode_Mulai} sampai ${row.Periode_Akhir}`,
        actionView: 'my-payroll',
        timestamp: row.Diterbitkan_At,
        priority: 'TINGGI',
      }));
      const announcements = await appNotifications(user);
      const items = [...announcements, ...payroll, ...nonGenerated]
        .sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      return json({ success: true, result: { ...base, count: items.length, items }, requestId }, 200, requestId);
    }

    if (functionName === 'getOperationalDashboardV2') {
      const user = await authenticate(body.data?.token);
      const ids = await scopedUserIds(user);
      const legacy = await forward(LEGACY_CORE_URL, body, request);
      const failure = legacyFailure(legacy);
      if (failure) return json({ ...failure.body, requestId }, failure.status, requestId);
      if (!legacy.payload) return new Response(legacy.text, { status: legacy.status, headers: { ...headers, 'x-request-id': requestId } });
      let count = 0;
      if (ids.length) {
        const result = await db.from('Slip_Gaji')
          .select('ID_Slip', { count: 'exact', head: true })
          .in('ID_User', ids)
          .eq('Status_Penerbitan', 'MENUNGGU_TTD_PENERIMA');
        if (result.error) throw result.error;
        count = Number(result.count || 0);
      }
      if (legacy.payload?.result?.totals) legacy.payload.result.totals.pendingRecipientSignatures = count;
      const status = legacy.status >= 200 && legacy.status < 300 ? legacy.status : 500;
      return json({ ...legacy.payload, requestId }, status, requestId);
    }

    const legacy = await forward(LEGACY_CORE_URL, body, request);
    return forwardResponse(legacy, requestId);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const mapped = mappedError(raw);
    console.error(JSON.stringify({ requestId, function: functionName, code: mapped.code, status: mapped.status, error: raw }));
    return json({ success: false, code: mapped.code, message: mapped.message, error: raw, requestId }, mapped.status, requestId);
  }
});