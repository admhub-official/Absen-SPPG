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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
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

async function forwardLocation(body: any, request: Request): Promise<Response | null> {
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
  return new Response(result.text, { status: result.status, headers });
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
    .select('*')
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
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ success: false, error: 'Method tidak didukung' }, 405);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Body JSON tidak valid' }, 400);
  }

  try {
    const locationResponse = await forwardLocation(body, request);
    if (locationResponse) return locationResponse;

    if (body.function === 'getSuperAdminOverviewV3') {
      const user = await authenticate(body.data?.token);
      return json({ success: true, result: await superAdminOverview(user) });
    }

    if (body.function === 'getUserNotificationsV2') {
      const user = await authenticate(body.data?.token);
      const legacy = await forward(LEGACY_CORE_URL, body, request);
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
      return json({ success: true, result: { ...base, count: items.length, items } });
    }

    if (body.function === 'getOperationalDashboardV2') {
      const user = await authenticate(body.data?.token);
      const ids = await scopedUserIds(user);
      const legacy = await forward(LEGACY_CORE_URL, body, request);
      if (!legacy.payload) return new Response(legacy.text, { status: legacy.status, headers });
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
      return json(legacy.payload, legacy.status);
    }

    const legacy = await forward(LEGACY_CORE_URL, body, request);
    return new Response(legacy.text, { status: legacy.status, headers });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
