import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const VERSION = '1.0.1';
const ALLOWED_KEYS = [
  'menu.user.complaints',
  'menu.admin.payroll',
  'menu.admin.audit',
  'attendance.geofence_required',
  'attendance.capture_gps_accuracy',
  'attendance.allow_import_single_punch',
  'attendance.correction_requires_audit',
  'payroll.recipient_signature_required',
  'payroll.accountant_signature_required',
  'payroll.head_signature_required',
  'payroll.private_pdf',
  'notification.new_slip',
  'notification.complaint_reply',
  'notification.incomplete_attendance',
  'notification.global_announcement',
  'security.idle_session_expiry',
  'security.revoke_on_password_reset',
  'security.risky_action_reason',
  'security.two_step_confirmation',
] as const;
const allowed = new Set<string>(ALLOWED_KEYS);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function normalizeRole(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
}

async function authenticate(tokenValue: unknown) {
  const token = String(tokenValue || '').trim();
  if (!token) throw new Error('SESI_HABIS');

  const { data: session, error: sessionError } = await db.from('Sessions')
    .select('ID_User,Type,Expires_At')
    .eq('Token', token)
    .gt('Expires_At', new Date().toISOString())
    .maybeSingle();
  if (sessionError || !session || String(session.Type || '').toLowerCase() !== 'user') {
    throw new Error('SESI_HABIS');
  }

  const { data: user, error: userError } = await db.from('Users')
    .select('ID_User,Role,Status_Aktif')
    .eq('ID_User', session.ID_User)
    .maybeSingle();
  if (userError || !user || user.Status_Aktif !== true) throw new Error('AKUN_NONAKTIF');
  if (normalizeRole(user.Role) !== 'SUPER ADMIN') throw new Error('Akses hanya untuk SUPER ADMIN.');
  return { idUser: String(user.ID_User) };
}

function serialize(row: any) {
  return {
    Setting_Key: String(row.Setting_Key),
    Setting_Value: row.Setting_Value || {},
    Description: row.Description || '',
    Updated_At: row.Updated_At || null,
    Updated_By: row.Updated_By || null,
    _enabled: Boolean(row.Setting_Value?.enabled),
  };
}

async function readSettings() {
  const { data, error } = await db.from('System_Settings')
    .select('Setting_Key,Setting_Value,Description,Updated_At,Updated_By')
    .in('Setting_Key', [...ALLOWED_KEYS])
    .order('Setting_Key');
  if (error) throw error;
  const items = (data || []).map(serialize);
  const returned = new Set(items.map((item) => item.Setting_Key));
  const missing = ALLOWED_KEYS.filter((key) => !returned.has(key));
  if (missing.length) throw new Error(`Pengaturan backend belum lengkap: ${missing.join(', ')}`);
  return items;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return respond({ success: false, message: 'Method tidak didukung.' }, 405);

  try {
    const body = await request.json();
    const user = await authenticate(body.token);
    const action = String(body.action || 'getSettings');

    if (action === 'health') {
      return respond({ success: true, result: { version: VERSION, ready: true, settings: ALLOWED_KEYS.length } });
    }

    if (action === 'getSettings') {
      return respond({ success: true, result: { version: VERSION, items: await readSettings() } });
    }

    if (action === 'updateSetting') {
      const key = String(body.key || '').trim();
      if (!allowed.has(key)) throw new Error('Kunci pengaturan tidak diizinkan.');
      if (typeof body.enabled !== 'boolean') throw new Error('Nilai aktif/nonaktif wajib berupa boolean.');
      const reason = String(body.reason || '').trim();
      if (reason.length < 10 || reason.length > 500) throw new Error('Alasan perubahan wajib 10 sampai 500 karakter.');

      const { data, error } = await db.rpc('update_system_setting_v1', {
        p_key: key,
        p_enabled: body.enabled,
        p_user_id: user.idUser,
        p_description: String(body.description || key),
        p_reason: reason,
      });
      if (error) throw error;

      const { data: verified, error: verifyError } = await db.from('System_Settings')
        .select('Setting_Key,Setting_Value,Description,Updated_At,Updated_By')
        .eq('Setting_Key', key)
        .single();
      if (verifyError) throw verifyError;
      const item = serialize(verified);
      if (item._enabled !== body.enabled) throw new Error('Verifikasi nilai backend tidak sesuai.');
      return respond({ success: true, result: { version: VERSION, item, rpc: data } });
    }

    throw new Error('Aksi tidak dikenali.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan.';
    const status = message === 'SESI_HABIS' ? 401 : /Akses hanya|AKUN_NONAKTIF/.test(message) ? 403 : 400;
    return respond({ success: false, message }, status);
  }
});
