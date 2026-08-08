import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(requestId ? { 'X-Request-Id': requestId } : {}) },
});

const norm = (value: unknown) => String(value || '').trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
const isActive = (value: unknown) => value === true || value === 1 || ['TRUE', '1'].includes(String(value || '').toUpperCase());

function stringArray(value: unknown, field: string, maxItems = 500): string[] {
  if (!Array.isArray(value)) throw new Error(`VALIDATION_${field.toUpperCase()}`);
  if (value.length > maxItems) throw new Error(`VALIDATION_${field.toUpperCase()}`);
  const result = [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  if (result.length !== value.filter((item) => String(item || '').trim()).length && value.some((item) => typeof item !== 'string')) {
    throw new Error(`VALIDATION_${field.toUpperCase()}`);
  }
  return result;
}

async function auth(token: unknown) {
  const value = String(token || '').trim();
  if (!value) throw new Error('SESI_HABIS');
  const { data: session, error: sessionError } = await db.from('Sessions')
    .select('ID_User,Expires_At')
    .eq('Token', value)
    .gt('Expires_At', new Date().toISOString())
    .maybeSingle();
  if (sessionError) throw new Error('SESSION_QUERY_FAILED');
  if (!session) throw new Error('SESI_HABIS');
  const { data: user, error } = await db.from('Users')
    .select('ID_User,Nama_Lengkap,Email,Role,SPPG,Status_Aktif')
    .eq('ID_User', session.ID_User)
    .maybeSingle();
  if (error) throw new Error('ACCOUNT_QUERY_FAILED');
  if (!user || !isActive(user.Status_Aktif)) throw new Error('AKUN_NONAKTIF');
  return { ...user, Role: norm(user.Role) };
}

function requireSuper(user: any) {
  if (user.Role !== 'SUPER ADMIN') throw new Error('FORBIDDEN');
}

async function isGlobalAnnouncementEnabled() {
  const { data, error } = await db.from('System_Settings')
    .select('Setting_Value')
    .eq('Setting_Key', 'notification.global_announcement')
    .maybeSingle();
  if (error) throw new Error('GLOBAL_ANNOUNCEMENT_SETTING_FAILED');
  return Boolean(data?.Setting_Value?.enabled);
}

async function validateTargets(targetMode: string, body: any) {
  const allowedModes = ['ALL', 'ROLES', 'SPPG', 'USERS'];
  if (!allowedModes.includes(targetMode)) throw new Error('Target tidak valid.');

  const result = { roles: [] as string[], sppg: [] as string[], users: [] as string[] };
  if (targetMode === 'ALL') return result;

  if (targetMode === 'ROLES') {
    const allowedRoles = new Set(['USER', 'ADMIN', 'AKUNTAN', 'SUPER ADMIN']);
    result.roles = stringArray(body.targetRoles, 'targetRoles', 10).map(norm);
    if (!result.roles.length || result.roles.some((role) => !allowedRoles.has(role))) throw new Error('Pilih minimal satu role tujuan yang valid.');
    return result;
  }

  if (targetMode === 'SPPG') {
    result.sppg = stringArray(body.targetSppg, 'targetSppg', 500);
    if (!result.sppg.length) throw new Error('Pilih minimal satu SPPG tujuan.');
    const { data, error } = await db.from('Master_SPPG').select('Nama_SPPG').in('Nama_SPPG', result.sppg);
    if (error) throw new Error('TARGET_SPPG_QUERY_FAILED');
    const valid = new Set((data || []).map((row: any) => String(row.Nama_SPPG)));
    if (result.sppg.some((name) => !valid.has(name))) throw new Error('Terdapat SPPG tujuan yang tidak valid.');
    return result;
  }

  result.users = stringArray(body.targetUserIds, 'targetUserIds', 3000);
  if (!result.users.length) throw new Error('Pilih minimal satu pengguna tujuan.');
  const { data, error } = await db.from('Users').select('ID_User').in('ID_User', result.users).eq('Status_Aktif', true);
  if (error) throw new Error('TARGET_USER_QUERY_FAILED');
  const valid = new Set((data || []).map((row: any) => String(row.ID_User)));
  if (result.users.some((id) => !valid.has(id))) throw new Error('Terdapat pengguna tujuan yang tidak valid atau nonaktif.');
  return result;
}

function optionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`VALIDATION_${field.toUpperCase()}`);
  return value;
}

async function notificationPayload(body: any, user: any) {
  const title = String(body.title || '').trim();
  const message = String(body.message || '').trim();
  if (!title || !message) throw new Error('Judul dan isi notifikasi wajib diisi.');
  if (title.length > 120 || message.length > 1000) throw new Error('Judul maksimal 120 karakter dan isi maksimal 1.000 karakter.');

  const targetMode = norm(body.targetMode).replace(/ /g, '_');
  const targets = await validateTargets(targetMode, body);
  const status = norm(body.status || 'PUBLISHED').replace(/ /g, '_');
  if (!['DRAFT', 'PUBLISHED'].includes(status)) throw new Error('Status notifikasi tidak valid.');
  if (status === 'PUBLISHED' && !(await isGlobalAnnouncementEnabled())) {
    throw new Error('Aktifkan Pengumuman Global sebelum menerbitkan notifikasi.');
  }

  const priority = norm(body.priority || 'NORMAL');
  if (!['RENDAH', 'NORMAL', 'TINGGI', 'MENDESAK'].includes(priority)) throw new Error('Prioritas notifikasi tidak valid.');
  const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (Number.isNaN(startsAt.getTime())) throw new Error('Waktu mulai tidak valid.');
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('Waktu berakhir tidak valid.');
  if (expiresAt && expiresAt <= startsAt) throw new Error('Waktu berakhir harus setelah waktu mulai.');

  return {
    Title: title,
    Message: message,
    Priority: priority,
    Target_Mode: targetMode,
    Target_Roles: targets.roles,
    Target_SPPG: targets.sppg,
    Target_User_IDs: targets.users,
    Show_Banner: optionalBoolean(body.showBanner, 'showBanner', true),
    Play_Sound: optionalBoolean(body.playSound, 'playSound', true),
    Push_Enabled: optionalBoolean(body.pushEnabled, 'pushEnabled', true),
    Action_View: String(body.actionView || 'dashboard').trim().slice(0, 80),
    Starts_At: startsAt.toISOString(),
    Expires_At: expiresAt ? expiresAt.toISOString() : null,
    Status: status,
    Created_By: user.ID_User,
  };
}

function targetMatches(notification: any, user: any) {
  if (notification.Target_Mode === 'ALL') return true;
  if (notification.Target_Mode === 'ROLES') return (notification.Target_Roles || []).map(norm).includes(user.Role);
  if (notification.Target_Mode === 'SPPG') return (notification.Target_SPPG || []).includes(user.SPPG);
  if (notification.Target_Mode === 'USERS') return (notification.Target_User_IDs || []).includes(user.ID_User);
  return false;
}

async function getOperationalNotifications(user: any) {
  const [{ data: slips, error: slipError }, { data: complaints, error: complaintError }] = await Promise.all([
    db.from('Slip_Gaji')
      .select('ID_Slip,Periode_Mulai,Periode_Akhir,Diterbitkan_At,Created_At')
      .eq('ID_User', user.ID_User)
      .in('Status_Penerbitan', ['DITERBITKAN', 'MENUNGGU_TTD_PENERIMA'])
      .is('TTD_Penerima_Path', null)
      .order('Diterbitkan_At', { ascending: false, nullsFirst: false })
      .limit(25),
    db.from('Pengaduan')
      .select('ID_Pengaduan,Kategori,Tanggapan_Admin,Waktu_Tanggapan,Status_Tiket')
      .or(`User_Pengirim.eq.${user.ID_User},User.eq.${user.ID_User}`)
      .not('Tanggapan_Admin', 'is', null)
      .order('Waktu_Tanggapan', { ascending: false, nullsFirst: false })
      .limit(25),
  ]);
  if (slipError) throw new Error('OPERATIONAL_SLIP_QUERY_FAILED');
  if (complaintError) throw new Error('OPERATIONAL_COMPLAINT_QUERY_FAILED');

  const items = [
    ...(slips || []).map((slip: any) => ({
      ID_Notification: `op:slip:${slip.ID_Slip}`,
      Title: 'Slip gaji menunggu tanda tangan',
      Message: `Slip periode ${slip.Periode_Mulai} s.d. ${slip.Periode_Akhir} perlu ditandatangani.`,
      Priority: 'TINGGI', Action_View: 'payroll-saya', Entity_ID: slip.ID_Slip,
      Created_At: slip.Diterbitkan_At || slip.Created_At || new Date().toISOString(), Operational: true,
    })),
    ...(complaints || []).map((complaint: any) => ({
      ID_Notification: `op:pengaduan:${complaint.ID_Pengaduan}`,
      Title: 'Pengaduan mendapat tanggapan', Message: String(complaint.Tanggapan_Admin || '').slice(0, 220),
      Priority: 'NORMAL', Action_View: 'pengaduan', Entity_ID: complaint.ID_Pengaduan,
      Created_At: complaint.Waktu_Tanggapan || new Date().toISOString(), Operational: true,
    })),
  ];

  const keys = items.map((item) => item.ID_Notification);
  let readRows: any[] = [];
  if (keys.length) {
    const readResult = await db.from('App_Operational_Notification_Read')
      .select('Notification_Key').eq('ID_User', user.ID_User).in('Notification_Key', keys);
    if (readResult.error) throw new Error('OPERATIONAL_READ_QUERY_FAILED');
    readRows = readResult.data || [];
  }
  const readSet = new Set(readRows.map((row: any) => row.Notification_Key));
  return items.map((item) => ({ ...item, Read: readSet.has(item.ID_Notification) }));
}

function mapError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === 'SESI_HABIS') return { status: 401, code: 'SESSION_EXPIRED', message: 'Sesi telah berakhir. Silakan login kembali.' };
  if (raw === 'AKUN_NONAKTIF') return { status: 403, code: 'ACCOUNT_INACTIVE', message: 'Akun tidak aktif.' };
  if (raw === 'FORBIDDEN' || /Hanya SUPER ADMIN/i.test(raw)) return { status: 403, code: 'FORBIDDEN', message: 'Akses ditolak.' };
  if (/tidak ditemukan/i.test(raw)) return { status: 404, code: 'NOT_FOUND', message: raw };
  if (raw.startsWith('VALIDATION_') || /wajib|tidak valid|Pilih minimal|maksimal|harus setelah|tidak dikenali/i.test(raw)) return { status: 422, code: 'VALIDATION_ERROR', message: raw.startsWith('VALIDATION_') ? 'Payload konfigurasi tidak valid.' : raw };
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Layanan konfigurasi gagal memproses permintaan.' };
}

Deno.serve(async (req) => {
  const requestId = `CFG_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Gunakan POST.', requestId }, 405, requestId);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, code: 'INVALID_JSON', message: 'Body JSON tidak valid.', requestId }, 400, requestId);
  }

  try {
    const action = String(body.action || '').trim();
    if (!action) return json({ success: false, code: 'ACTION_REQUIRED', message: 'Action wajib diisi.', requestId }, 422, requestId);
    const user = await auth(body.token);

    if (action === 'getFaceStatus') {
      const { data, error } = await db.rpc('is_face_attendance_enabled', { p_user_id: user.ID_User });
      if (error) throw new Error('FACE_STATUS_QUERY_FAILED');
      return json({ success: true, result: { enabled: Boolean(data) }, requestId }, 200, requestId);
    }

    if (action === 'adminConfig') {
      requireSuper(user);
      const [{ data: users, error: userError }, { data: policies, error: policyError }, { data: sppg, error: sppgError }] = await Promise.all([
        db.from('Users').select('ID_User,Nama_Lengkap,SPPG,Jabatan_Divisi,Status_Aktif').eq('Role', 'USER').eq('Status_Aktif', true).order('SPPG').order('Nama_Lengkap'),
        db.from('Face_Attendance_Policy').select('*'),
        db.from('Master_SPPG').select('Nama_SPPG,Yayasan').order('Nama_SPPG'),
      ]);
      if (userError || policyError || sppgError) throw new Error('ADMIN_CONFIG_QUERY_FAILED');
      return json({ success: true, result: { users, policies, sppg }, requestId }, 200, requestId);
    }

    if (action === 'saveFacePolicy') {
      requireSuper(user);
      const scope = norm(body.scope).replace(/ /g, '_');
      if (typeof body.enabled !== 'boolean') throw new Error('VALIDATION_ENABLED');
      const enabled = body.enabled;
      if (scope === 'GLOBAL') {
        const deleted = await db.from('Face_Attendance_Policy').delete().eq('Scope_Type', 'GLOBAL');
        if (deleted.error) throw new Error('FACE_POLICY_DELETE_FAILED');
        const inserted = await db.from('Face_Attendance_Policy').insert({ Scope_Type: 'GLOBAL', Enabled: enabled, Updated_By: user.ID_User });
        if (inserted.error) throw new Error('FACE_POLICY_SAVE_FAILED');
      } else if (scope === 'SPPG') {
        const list = stringArray(body.sppg, 'sppg', 500);
        if (!list.length) throw new Error('Pilih minimal satu SPPG.');
        for (const name of list) {
          const existing = await db.from('Face_Attendance_Policy').select('ID_Policy').eq('Scope_Type', 'SPPG').eq('SPPG', name).maybeSingle();
          if (existing.error) throw new Error('FACE_POLICY_LOOKUP_FAILED');
          const query = existing.data
            ? db.from('Face_Attendance_Policy').update({ Enabled: enabled, Updated_By: user.ID_User, Updated_At: new Date().toISOString() }).eq('ID_Policy', existing.data.ID_Policy)
            : db.from('Face_Attendance_Policy').insert({ Scope_Type: 'SPPG', SPPG: name, Enabled: enabled, Updated_By: user.ID_User });
          const { error } = await query;
          if (error) throw new Error('FACE_POLICY_SAVE_FAILED');
        }
      } else if (scope === 'USER') {
        const ids = stringArray(body.userIds, 'userIds', 3000);
        if (!ids.length) throw new Error('Pilih minimal satu karyawan.');
        const { data: targets, error: targetError } = await db.from('Users').select('ID_User,SPPG').in('ID_User', ids).eq('Status_Aktif', true);
        if (targetError) throw new Error('FACE_POLICY_TARGET_QUERY_FAILED');
        if ((targets || []).length !== ids.length) throw new Error('Terdapat karyawan yang tidak valid atau nonaktif.');
        for (const target of targets || []) {
          const existing = await db.from('Face_Attendance_Policy').select('ID_Policy').eq('Scope_Type', 'USER').eq('ID_User', target.ID_User).maybeSingle();
          if (existing.error) throw new Error('FACE_POLICY_LOOKUP_FAILED');
          const query = existing.data
            ? db.from('Face_Attendance_Policy').update({ Enabled: enabled, SPPG: target.SPPG, Updated_By: user.ID_User, Updated_At: new Date().toISOString() }).eq('ID_Policy', existing.data.ID_Policy)
            : db.from('Face_Attendance_Policy').insert({ Scope_Type: 'USER', SPPG: target.SPPG, ID_User: target.ID_User, Enabled: enabled, Updated_By: user.ID_User });
          const { error } = await query;
          if (error) throw new Error('FACE_POLICY_SAVE_FAILED');
        }
      } else throw new Error('Scope tidak valid.');
      return json({ success: true, result: { updated: true }, requestId }, 200, requestId);
    }

    if (action === 'adminNotificationConfig') {
      requireSuper(user);
      const [{ data: setting, error: settingError }, { data: sppg, error: sppgError }, { data: users, error: usersError }] = await Promise.all([
        db.from('System_Settings').select('Setting_Value,Updated_At').eq('Setting_Key', 'notification.global_announcement').maybeSingle(),
        db.from('Master_SPPG').select('Nama_SPPG,Yayasan').order('Nama_SPPG'),
        db.from('Users').select('ID_User,Nama_Lengkap,SPPG,Role').eq('Status_Aktif', true).order('Nama_Lengkap').limit(3000),
      ]);
      if (settingError || sppgError || usersError) throw new Error('NOTIFICATION_CONFIG_QUERY_FAILED');
      return json({ success: true, result: { enabled: Boolean(setting?.Setting_Value?.enabled), updatedAt: setting?.Updated_At || null, sppg: sppg || [], users: users || [] }, requestId }, 200, requestId);
    }

    if (action === 'listAdminNotifications') {
      requireSuper(user);
      const { data, error } = await db.from('App_Notifications').select('*').neq('Status', 'DELETED').order('Created_At', { ascending: false }).limit(200);
      if (error) throw new Error('NOTIFICATION_LIST_FAILED');
      return json({ success: true, result: { items: data || [] }, requestId }, 200, requestId);
    }

    if (action === 'saveNotification') {
      requireSuper(user);
      const payload = await notificationPayload(body, user);
      const id = String(body.id || '').trim();
      if (id) {
        if (id.length > 160) throw new Error('VALIDATION_NOTIFICATION_ID');
        const { Created_By: _createdBy, ...updates } = payload;
        const { data, error } = await db.from('App_Notifications').update(updates).eq('ID_Notification', id).neq('Status', 'DELETED').select().maybeSingle();
        if (error) throw new Error('NOTIFICATION_SAVE_FAILED');
        if (!data) throw new Error('Pengumuman tidak ditemukan.');
        return json({ success: true, result: data, requestId }, 200, requestId);
      }
      const { data, error } = await db.from('App_Notifications').insert(payload).select().single();
      if (error) throw new Error('NOTIFICATION_SAVE_FAILED');
      return json({ success: true, result: data, requestId }, 201, requestId);
    }

    if (action === 'setNotificationStatus') {
      requireSuper(user);
      const id = String(body.id || '').trim();
      const status = norm(body.status).replace(/ /g, '_');
      if (!id || id.length > 160 || !['DRAFT', 'PUBLISHED'].includes(status)) throw new Error('Status notifikasi tidak valid.');
      if (status === 'PUBLISHED' && !(await isGlobalAnnouncementEnabled())) throw new Error('Aktifkan Pengumuman Global sebelum menerbitkan notifikasi.');
      const { data, error } = await db.from('App_Notifications').update({ Status: status }).eq('ID_Notification', id).neq('Status', 'DELETED').select().maybeSingle();
      if (error) throw new Error('NOTIFICATION_STATUS_FAILED');
      if (!data) throw new Error('Pengumuman tidak ditemukan.');
      return json({ success: true, result: data, requestId }, 200, requestId);
    }

    if (action === 'deleteNotification') {
      requireSuper(user);
      const id = String(body.id || '').trim();
      if (!id || id.length > 160) throw new Error('ID pengumuman wajib.');
      const { data, error } = await db.from('App_Notifications').update({ Status: 'DELETED', Expires_At: new Date().toISOString() }).eq('ID_Notification', id).select('ID_Notification').maybeSingle();
      if (error) throw new Error('NOTIFICATION_DELETE_FAILED');
      if (!data) throw new Error('Pengumuman tidak ditemukan.');
      return json({ success: true, result: { deleted: true, id: data.ID_Notification }, requestId }, 200, requestId);
    }

    if (action === 'publishNotification') {
      requireSuper(user);
      const payload = await notificationPayload({ ...body, status: 'PUBLISHED' }, user);
      const { data, error } = await db.from('App_Notifications').insert(payload).select().single();
      if (error) throw new Error('NOTIFICATION_PUBLISH_FAILED');
      return json({ success: true, result: data, requestId }, 201, requestId);
    }

    if (action === 'getNotifications') {
      const now = new Date().toISOString();
      const { data, error } = await db.from('App_Notifications')
        .select('*').eq('Status', 'PUBLISHED').lte('Starts_At', now)
        .or(`Expires_At.is.null,Expires_At.gt.${now}`)
        .order('Created_At', { ascending: false }).limit(100);
      if (error) throw new Error('NOTIFICATION_QUERY_FAILED');
      const matched: any[] = [];
      for (const notification of data || []) if (targetMatches(notification, user)) matched.push(notification);
      const ids = matched.map((notification: any) => notification.ID_Notification);
      let readRows: any[] = [];
      if (ids.length) {
        const readResult = await db.from('App_Notification_Read').select('ID_Notification').eq('ID_User', user.ID_User).in('ID_Notification', ids);
        if (readResult.error) throw new Error('NOTIFICATION_READ_QUERY_FAILED');
        readRows = readResult.data || [];
      }
      const readSet = new Set(readRows.map((row: any) => row.ID_Notification));
      const regular = matched.map((notification: any) => ({ ...notification, Read: readSet.has(notification.ID_Notification), Operational: false }));
      const operational = await getOperationalNotifications(user);
      const items = [...operational, ...regular].sort((a: any, b: any) => new Date(b.Created_At).getTime() - new Date(a.Created_At).getTime());
      return json({ success: true, result: { items, unread: items.filter((item: any) => !item.Read).length }, requestId }, 200, requestId);
    }

    if (action === 'markRead') {
      const id = String(body.id || '').trim();
      if (!id || id.length > 200) throw new Error('ID notifikasi wajib.');
      if (id.startsWith('op:')) {
        const { error } = await db.from('App_Operational_Notification_Read').upsert({ ID_User: user.ID_User, Notification_Key: id, Read_At: new Date().toISOString() });
        if (error) throw new Error('NOTIFICATION_MARK_READ_FAILED');
      } else {
        const { error } = await db.from('App_Notification_Read').upsert({ ID_Notification: id, ID_User: user.ID_User, Read_At: new Date().toISOString() });
        if (error) throw new Error('NOTIFICATION_MARK_READ_FAILED');
      }
      return json({ success: true, result: { updated: true }, requestId }, 200, requestId);
    }

    if (action === 'registerPush') {
      if (!body.subscription || typeof body.subscription !== 'object' || Array.isArray(body.subscription)) throw new Error('Subscription tidak valid.');
      const subscription = body.subscription as any;
      const endpoint = String(subscription.endpoint || '').trim();
      const p256dh = String(subscription.keys?.p256dh || '').trim();
      const authKey = String(subscription.keys?.auth || '').trim();
      if (!endpoint || endpoint.length > 4000 || !p256dh || p256dh.length > 1000 || !authKey || authKey.length > 1000) throw new Error('Subscription tidak valid.');
      const { error } = await db.from('Push_Subscriptions').upsert({
        ID_User: user.ID_User, Endpoint: endpoint, P256DH: p256dh, Auth: authKey,
        User_Agent: String(body.userAgent || '').slice(0, 1000), Device_Label: String(body.deviceLabel || '').slice(0, 240), Is_Active: true, Updated_At: new Date().toISOString(),
      }, { onConflict: 'Endpoint' });
      if (error) throw new Error('PUSH_SUBSCRIPTION_SAVE_FAILED');
      return json({ success: true, result: { registered: true }, requestId }, 200, requestId);
    }

    return json({ success: false, code: 'ACTION_NOT_SUPPORTED', message: 'Aksi tidak dikenali.', requestId }, 422, requestId);
  } catch (error) {
    const mapped = mapError(error);
    console.error(JSON.stringify({ requestId, code: mapped.code, status: mapped.status, error: error instanceof Error ? error.message : String(error) }));
    return json({ success: false, code: mapped.code, message: mapped.message, requestId }, mapped.status, requestId);
  }
});