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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const norm = (value: unknown) => String(value || '').trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
const uniqueStrings = (values: unknown[]) => [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];

async function auth(token: unknown) {
  const value = String(token || '').trim();
  if (!value) throw new Error('SESI_HABIS');
  const { data: session } = await db.from('Sessions')
    .select('ID_User,Expires_At')
    .eq('Token', value)
    .gt('Expires_At', new Date().toISOString())
    .maybeSingle();
  if (!session) throw new Error('SESI_HABIS');
  const { data: user, error } = await db.from('Users')
    .select('ID_User,Nama_Lengkap,Email,Role,SPPG,Status_Aktif')
    .eq('ID_User', session.ID_User)
    .maybeSingle();
  if (error || !user?.Status_Aktif) throw new Error('AKUN_NONAKTIF');
  return { ...user, Role: norm(user.Role) };
}

function requireSuper(user: any) {
  if (user.Role !== 'SUPER ADMIN') throw new Error('Akses hanya untuk SUPER ADMIN.');
}

async function isGlobalAnnouncementEnabled() {
  const { data, error } = await db.from('System_Settings')
    .select('Setting_Value')
    .eq('Setting_Key', 'notification.global_announcement')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.Setting_Value?.enabled);
}

async function validateTargets(targetMode: string, body: any) {
  const allowedModes = ['ALL', 'ROLES', 'SPPG', 'USERS'];
  if (!allowedModes.includes(targetMode)) throw new Error('Target tidak valid.');

  const result = { roles: [] as string[], sppg: [] as string[], users: [] as string[] };
  if (targetMode === 'ALL') return result;

  if (targetMode === 'ROLES') {
    const allowedRoles = new Set(['USER', 'ADMIN', 'AKUNTAN', 'SUPER ADMIN']);
    result.roles = uniqueStrings(body.targetRoles || []).map(norm).filter((role) => allowedRoles.has(role));
    if (!result.roles.length) throw new Error('Pilih minimal satu role tujuan.');
    return result;
  }

  if (targetMode === 'SPPG') {
    result.sppg = uniqueStrings(body.targetSppg || []);
    if (!result.sppg.length) throw new Error('Pilih minimal satu SPPG tujuan.');
    const { data, error } = await db.from('Master_SPPG').select('Nama_SPPG').in('Nama_SPPG', result.sppg);
    if (error) throw error;
    const valid = new Set((data || []).map((row: any) => String(row.Nama_SPPG)));
    if (result.sppg.some((name) => !valid.has(name))) throw new Error('Terdapat SPPG tujuan yang tidak valid.');
    return result;
  }

  result.users = uniqueStrings(body.targetUserIds || []);
  if (!result.users.length) throw new Error('Pilih minimal satu pengguna tujuan.');
  const { data, error } = await db.from('Users').select('ID_User').in('ID_User', result.users).eq('Status_Aktif', true);
  if (error) throw error;
  const valid = new Set((data || []).map((row: any) => String(row.ID_User)));
  if (result.users.some((id) => !valid.has(id))) throw new Error('Terdapat pengguna tujuan yang tidak valid atau nonaktif.');
  return result;
}

async function notificationPayload(body: any, user: any) {
  const title = String(body.title || '').trim();
  const message = String(body.message || '').trim();
  if (!title || !message) throw new Error('Judul dan isi notifikasi wajib diisi.');

  const targetMode = norm(body.targetMode).replace(/ /g, '_');
  const targets = await validateTargets(targetMode, body);
  const status = norm(body.status || 'PUBLISHED').replace(/ /g, '_');
  if (!['DRAFT', 'PUBLISHED'].includes(status)) throw new Error('Status notifikasi tidak valid.');
  if (status === 'PUBLISHED' && !(await isGlobalAnnouncementEnabled())) {
    throw new Error('Aktifkan Pengumuman Global sebelum menerbitkan notifikasi.');
  }

  const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (Number.isNaN(startsAt.getTime())) throw new Error('Waktu mulai tidak valid.');
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('Waktu berakhir tidak valid.');
  if (expiresAt && expiresAt <= startsAt) throw new Error('Waktu berakhir harus setelah waktu mulai.');

  return {
    Title: title.slice(0, 120),
    Message: message.slice(0, 1000),
    Priority: ['RENDAH', 'NORMAL', 'TINGGI', 'MENDESAK'].includes(norm(body.priority)) ? norm(body.priority) : 'NORMAL',
    Target_Mode: targetMode,
    Target_Roles: targets.roles,
    Target_SPPG: targets.sppg,
    Target_User_IDs: targets.users,
    Show_Banner: body.showBanner !== false,
    Play_Sound: body.playSound !== false,
    Push_Enabled: body.pushEnabled !== false,
    Action_View: String(body.actionView || 'dashboard').slice(0, 80),
    Starts_At: startsAt.toISOString(),
    Expires_At: expiresAt ? expiresAt.toISOString() : null,
    Status: status,
    Created_By: user.ID_User,
  };
}

async function targetMatches(notification: any, user: any) {
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
  if (slipError) throw slipError;
  if (complaintError) throw complaintError;

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
    if (readResult.error) throw readResult.error;
    readRows = readResult.data || [];
  }
  const readSet = new Set(readRows.map((row: any) => row.Notification_Key));
  return items.map((item) => ({ ...item, Read: readSet.has(item.ID_Notification) }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    const body = await req.json();
    const user = await auth(body.token);

    if (body.action === 'getFaceStatus') {
      const { data, error } = await db.rpc('is_face_attendance_enabled', { p_user_id: user.ID_User });
      if (error) throw error;
      return json({ success: true, result: { enabled: Boolean(data) } });
    }

    if (body.action === 'adminConfig') {
      requireSuper(user);
      const [{ data: users, error: userError }, { data: policies, error: policyError }, { data: sppg, error: sppgError }] = await Promise.all([
        db.from('Users').select('ID_User,Nama_Lengkap,SPPG,Jabatan_Divisi,Status_Aktif').eq('Role', 'USER').eq('Status_Aktif', true).order('SPPG').order('Nama_Lengkap'),
        db.from('Face_Attendance_Policy').select('*'),
        db.from('Master_SPPG').select('Nama_SPPG,Yayasan').order('Nama_SPPG'),
      ]);
      if (userError || policyError || sppgError) throw userError || policyError || sppgError;
      return json({ success: true, result: { users, policies, sppg } });
    }

    if (body.action === 'saveFacePolicy') {
      requireSuper(user);
      const scope = norm(body.scope).replace(/ /g, '_');
      const enabled = Boolean(body.enabled);
      if (scope === 'GLOBAL') {
        await db.from('Face_Attendance_Policy').delete().eq('Scope_Type', 'GLOBAL');
        const { error } = await db.from('Face_Attendance_Policy').insert({ Scope_Type: 'GLOBAL', Enabled: enabled, Updated_By: user.ID_User });
        if (error) throw error;
      } else if (scope === 'SPPG') {
        const list = uniqueStrings(body.sppg || []);
        if (!list.length) throw new Error('Pilih minimal satu SPPG.');
        for (const name of list) {
          const { data: existing } = await db.from('Face_Attendance_Policy').select('ID_Policy').eq('Scope_Type', 'SPPG').eq('SPPG', name).maybeSingle();
          const query = existing
            ? db.from('Face_Attendance_Policy').update({ Enabled: enabled, Updated_By: user.ID_User, Updated_At: new Date().toISOString() }).eq('ID_Policy', existing.ID_Policy)
            : db.from('Face_Attendance_Policy').insert({ Scope_Type: 'SPPG', SPPG: name, Enabled: enabled, Updated_By: user.ID_User });
          const { error } = await query;
          if (error) throw error;
        }
      } else if (scope === 'USER') {
        const ids = uniqueStrings(body.userIds || []);
        if (!ids.length) throw new Error('Pilih minimal satu karyawan.');
        const { data: targets, error: targetError } = await db.from('Users').select('ID_User,SPPG').in('ID_User', ids).eq('Status_Aktif', true);
        if (targetError) throw targetError;
        if ((targets || []).length !== ids.length) throw new Error('Terdapat karyawan yang tidak valid atau nonaktif.');
        for (const target of targets || []) {
          const { data: existing } = await db.from('Face_Attendance_Policy').select('ID_Policy').eq('Scope_Type', 'USER').eq('ID_User', target.ID_User).maybeSingle();
          const query = existing
            ? db.from('Face_Attendance_Policy').update({ Enabled: enabled, SPPG: target.SPPG, Updated_By: user.ID_User, Updated_At: new Date().toISOString() }).eq('ID_Policy', existing.ID_Policy)
            : db.from('Face_Attendance_Policy').insert({ Scope_Type: 'USER', SPPG: target.SPPG, ID_User: target.ID_User, Enabled: enabled, Updated_By: user.ID_User });
          const { error } = await query;
          if (error) throw error;
        }
      } else throw new Error('Scope tidak valid.');
      return json({ success: true });
    }

    if (body.action === 'adminNotificationConfig') {
      requireSuper(user);
      const [{ data: setting, error: settingError }, { data: sppg, error: sppgError }, { data: users, error: usersError }] = await Promise.all([
        db.from('System_Settings').select('Setting_Value,Updated_At').eq('Setting_Key', 'notification.global_announcement').maybeSingle(),
        db.from('Master_SPPG').select('Nama_SPPG,Yayasan').order('Nama_SPPG'),
        db.from('Users').select('ID_User,Nama_Lengkap,SPPG,Role').eq('Status_Aktif', true).order('Nama_Lengkap').limit(3000),
      ]);
      if (settingError || sppgError || usersError) throw settingError || sppgError || usersError;
      return json({ success: true, result: { enabled: Boolean(setting?.Setting_Value?.enabled), updatedAt: setting?.Updated_At || null, sppg: sppg || [], users: users || [] } });
    }

    if (body.action === 'listAdminNotifications') {
      requireSuper(user);
      const { data, error } = await db.from('App_Notifications').select('*').neq('Status', 'DELETED').order('Created_At', { ascending: false }).limit(200);
      if (error) throw error;
      return json({ success: true, result: { items: data || [] } });
    }

    if (body.action === 'saveNotification') {
      requireSuper(user);
      const payload = await notificationPayload(body, user);
      const id = String(body.id || '').trim();
      if (id) {
        const { Created_By: _createdBy, ...updates } = payload;
        const { data, error } = await db.from('App_Notifications').update(updates).eq('ID_Notification', id).neq('Status', 'DELETED').select().maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Pengumuman tidak ditemukan.');
        return json({ success: true, result: data });
      }
      const { data, error } = await db.from('App_Notifications').insert(payload).select().single();
      if (error) throw error;
      return json({ success: true, result: data });
    }

    if (body.action === 'setNotificationStatus') {
      requireSuper(user);
      const id = String(body.id || '').trim();
      const status = norm(body.status).replace(/ /g, '_');
      if (!id || !['DRAFT', 'PUBLISHED'].includes(status)) throw new Error('Status notifikasi tidak valid.');
      if (status === 'PUBLISHED' && !(await isGlobalAnnouncementEnabled())) throw new Error('Aktifkan Pengumuman Global sebelum menerbitkan notifikasi.');
      const { data, error } = await db.from('App_Notifications').update({ Status: status }).eq('ID_Notification', id).neq('Status', 'DELETED').select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Pengumuman tidak ditemukan.');
      return json({ success: true, result: data });
    }

    if (body.action === 'deleteNotification') {
      requireSuper(user);
      const id = String(body.id || '').trim();
      if (!id) throw new Error('ID pengumuman wajib.');
      const { data, error } = await db.from('App_Notifications').update({ Status: 'DELETED', Expires_At: new Date().toISOString() }).eq('ID_Notification', id).select('ID_Notification').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Pengumuman tidak ditemukan.');
      return json({ success: true });
    }

    if (body.action === 'publishNotification') {
      requireSuper(user);
      const payload = await notificationPayload({ ...body, status: 'PUBLISHED' }, user);
      const { data, error } = await db.from('App_Notifications').insert(payload).select().single();
      if (error) throw error;
      return json({ success: true, result: data });
    }

    if (body.action === 'getNotifications') {
      const { data, error } = await db.from('App_Notifications')
        .select('*').eq('Status', 'PUBLISHED').lte('Starts_At', new Date().toISOString())
        .or(`Expires_At.is.null,Expires_At.gt.${new Date().toISOString()}`)
        .order('Created_At', { ascending: false }).limit(100);
      if (error) throw error;
      const matched: any[] = [];
      for (const notification of data || []) if (await targetMatches(notification, user)) matched.push(notification);
      const ids = matched.map((notification: any) => notification.ID_Notification);
      let readRows: any[] = [];
      if (ids.length) {
        const readResult = await db.from('App_Notification_Read').select('ID_Notification').eq('ID_User', user.ID_User).in('ID_Notification', ids);
        if (readResult.error) throw readResult.error;
        readRows = readResult.data || [];
      }
      const readSet = new Set(readRows.map((row: any) => row.ID_Notification));
      const regular = matched.map((notification: any) => ({ ...notification, Read: readSet.has(notification.ID_Notification), Operational: false }));
      const operational = await getOperationalNotifications(user);
      const items = [...operational, ...regular].sort((a: any, b: any) => new Date(b.Created_At).getTime() - new Date(a.Created_At).getTime());
      return json({ success: true, result: { items, unread: items.filter((item: any) => !item.Read).length } });
    }

    if (body.action === 'markRead') {
      const id = String(body.id || '');
      if (!id) throw new Error('ID notifikasi wajib.');
      if (id.startsWith('op:')) {
        const { error } = await db.from('App_Operational_Notification_Read').upsert({ ID_User: user.ID_User, Notification_Key: id, Read_At: new Date().toISOString() });
        if (error) throw error;
      } else {
        const { error } = await db.from('App_Notification_Read').upsert({ ID_Notification: id, ID_User: user.ID_User, Read_At: new Date().toISOString() });
        if (error) throw error;
      }
      return json({ success: true });
    }

    if (body.action === 'registerPush') {
      const subscription = body.subscription || {};
      if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) throw new Error('Subscription tidak valid.');
      const { error } = await db.from('Push_Subscriptions').upsert({
        ID_User: user.ID_User, Endpoint: subscription.endpoint, P256DH: subscription.keys.p256dh, Auth: subscription.keys.auth,
        User_Agent: String(body.userAgent || ''), Device_Label: String(body.deviceLabel || ''), Is_Active: true, Updated_At: new Date().toISOString(),
      }, { onConflict: 'Endpoint' });
      if (error) throw error;
      return json({ success: true });
    }

    throw new Error('Aksi tidak dikenali.');
  } catch (error) {
    console.error(error);
    return json({ success: false, message: error instanceof Error ? error.message : 'Terjadi kesalahan.' }, 400);
  }
});
