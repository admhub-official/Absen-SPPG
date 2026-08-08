import { createClient } from 'npm:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(requestId ? { 'X-Request-Id': requestId } : {}) } });
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const MAX_BASE64_LENGTH = 16 * 1024 * 1024;
const ALLOWED_MAPPING_MODES = new Set(['SINGLE', 'COPY_TO_MULTIPLE', 'IGNORE']);

function normalizeName(value = '') { return value.toUpperCase().normalize('NFKD').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function normalizeDepartment(value = '') { const n = normalizeName(value); if (n === 'ASLAP') return 'ASISTEN LAPANGAN'; return n.replace(/^DIVISI\s+/, ''); }
function parseTimeCell(value: unknown): string[] { if (value == null || value === '') return []; return String(value).split(/\r?\n|,|;/).map((v) => v.trim()).filter((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)); }
function excelDateToISO(value: unknown, year: number, month: number): string | null { if (value instanceof Date) return value.toISOString().slice(0, 10); const day = Number(value); if (!Number.isInteger(day) || day < 1 || day > 31) return null; return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function parsePeriod(rows: unknown[][]) {
  const text = rows.slice(0, 5).flat().map(String).join(' ');
  const match = text.match(/(\d{1,2})\s+Juli\s*[–-]\s*(\d{1,2})\s+Agustus\s+(20\d{2})/i);
  if (match) return { year: Number(match[3]), month: 7, start: `${match[3]}-07-${match[1].padStart(2, '0')}`, end: `${match[3]}-08-${match[2].padStart(2, '0')}` };
  const year = Number(text.match(/20\d{2}/)?.[0] || new Date().getFullYear());
  return { year, month: 7, start: null, end: null };
}
function parseWorkbook(base64Value: string) {
  const base64 = String(base64Value || '').trim();
  if (!base64 || base64.length > MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new Error('VALIDATION_FILE_BASE64');
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('VALIDATION_FILE_BASE64');
  }
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error('VALIDATION_FILE_SIZE');
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet || !workbook.Sheets[firstSheet]) throw new Error('Format file tidak dikenali atau tidak memiliki worksheet.');
  const sheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][];
  const period = parsePeriod(rows);
  const parsed: Array<{machineId:string;sourceName:string;department:string;date:string;scans:string[]}> = [];
  for (let i = 0; i < rows.length; i++) {
    if (normalizeName(String(rows[i]?.[0] || '')) !== 'ID') continue;
    const machineId = String(rows[i]?.[2] || '').trim();
    const sourceName = String(rows[i]?.[11] || '').trim();
    const department = normalizeDepartment(String(rows[i]?.[20] || ''));
    const dateRow = rows[i + 1] || [];
    const scanRow = rows[i + 3] || [];
    for (let c = 0; c < Math.max(dateRow.length, scanRow.length); c++) {
      const date = excelDateToISO(dateRow[c], period.year, period.month);
      const scans = parseTimeCell(scanRow[c]);
      if (date && scans.length) parsed.push({ machineId, sourceName, department, date, scans });
    }
  }
  if (!parsed.length) throw new Error('Format file tidak dikenali atau tidak berisi scan absensi.');
  return { period, rows: parsed };
}
async function requireSession(token: string) {
  if (!token.trim()) throw new Error('SESSION_EXPIRED');
  const { data: session, error: sessionError } = await db.from('Sessions').select('ID_User,Role,Expires_At').eq('Token', token).gt('Expires_At', new Date().toISOString()).maybeSingle();
  if (sessionError) throw new Error('SESSION_QUERY_FAILED');
  if (!session) throw new Error('SESSION_EXPIRED');
  const { data: user, error: userError } = await db.from('Users').select('ID_User,Nama_Lengkap,Role,SPPG,Yayasan,Status_Aktif').eq('ID_User', session.ID_User).single();
  if (userError) throw new Error('ACCOUNT_QUERY_FAILED');
  user.Role = normalizeName(user.Role);
  if (!user?.Status_Aktif) throw new Error('ACCOUNT_INACTIVE');
  if (user.Role === 'USER') throw new Error('FORBIDDEN');
  const { data: roleConfig, error: roleError } = await db.from('Attendance_Import_Role_Config').select('*').eq('Role', user.Role).maybeSingle();
  if (roleError) throw new Error('ROLE_CONFIG_QUERY_FAILED');
  if (!roleConfig?.Menu_Enabled || !roleConfig?.Can_Upload) throw new Error('FORBIDDEN');
  return { user, roleConfig };
}
async function allowedScopes(user: any) {
  if (user.Role === 'SUPER ADMIN') {
    const { data, error } = await db.from('Users').select('SPPG,Yayasan').not('SPPG', 'is', null);
    if (error) throw new Error('SCOPE_QUERY_FAILED');
    return [...new Map((data || []).filter((x) => x.SPPG).map((x) => [x.SPPG, x])).values()];
  }
  const { data, error } = await db.from('Admin_Access').select('SPPG,Yayasan').eq('ID_User_Admin', user.ID_User).eq('Aktif', true);
  if (error) throw new Error('SCOPE_QUERY_FAILED');
  const scopes = [...(data || [])];
  if (user.SPPG && !scopes.some((x) => x.SPPG === user.SPPG)) scopes.push({ SPPG: user.SPPG, Yayasan: user.Yayasan });
  return scopes;
}
function confidence(source: string, target: string) { const a = new Set(normalizeName(source).split(' ')); const b = new Set(normalizeName(target).split(' ')); const intersection = [...a].filter((x) => b.has(x)).length; return intersection / Math.max(a.size, b.size, 1); }

function validateRoleConfig(body: Record<string, any>) {
  const role = normalizeName(String(body.role || ''));
  if (!['USER', 'ADMIN', 'AKUNTAN', 'SUPER ADMIN'].includes(role)) throw new Error('VALIDATION_ROLE');
  if (body.config !== undefined && (!body.config || typeof body.config !== 'object' || Array.isArray(body.config))) throw new Error('VALIDATION_CONFIG');
  const config = { ...(body.config || {}) } as Record<string, unknown>;
  for (const field of ['Menu_Enabled', 'Can_Upload', 'Can_Save_Mapping', 'Can_Force_Duplicate']) {
    if (config[field] !== undefined && typeof config[field] !== 'boolean') throw new Error(`VALIDATION_${field.toUpperCase()}`);
  }
  if (role === 'USER') return { role, config: { Menu_Enabled: false, Can_Upload: false, Can_Save_Mapping: false, Can_Force_Duplicate: false } };
  return { role, config };
}

function validateCommitEmployees(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 1000) throw new Error('VALIDATION_EMPLOYEES');
  return value.map((raw: any, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`VALIDATION_EMPLOYEE_${index}`);
    const mappingMode = String(raw.mappingMode || 'SINGLE').trim().toUpperCase();
    if (!ALLOWED_MAPPING_MODES.has(mappingMode)) throw new Error('VALIDATION_MAPPING_MODE');
    const targetUserIds = Array.isArray(raw.targetUserIds)
      ? [...new Set(raw.targetUserIds.map((id: unknown) => String(id || '').trim()).filter(Boolean))]
      : [];
    if (targetUserIds.length > 20) throw new Error('VALIDATION_TARGET_USERS');
    if (mappingMode === 'COPY_TO_MULTIPLE' && targetUserIds.length < 2) throw new Error('Pemetaan beberapa akun wajib memilih minimal dua akun tujuan.');
    if (mappingMode === 'SINGLE' && targetUserIds.length !== 1) throw new Error('Pemetaan satu akun wajib memilih tepat satu akun tujuan.');
    const attendance = Array.isArray(raw.attendance) ? raw.attendance : [];
    if (attendance.length > 400) throw new Error('VALIDATION_ATTENDANCE_ROWS');
    const cleanAttendance = attendance.map((day: any) => {
      const date = String(day?.date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw new Error('VALIDATION_ATTENDANCE_DATE');
      if (!Array.isArray(day?.scans) || day.scans.length < 1 || day.scans.length > 24) throw new Error('VALIDATION_SCANS');
      const scans = day.scans.map((scan: unknown) => String(scan || '').trim());
      if (scans.some((scan: string) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(scan))) throw new Error('VALIDATION_SCAN_TIME');
      return { date, scans };
    });
    return {
      machineId: String(raw.machineId || '').trim().slice(0, 160),
      sourceName: String(raw.sourceName || '').trim().slice(0, 240),
      department: String(raw.department || '').trim().slice(0, 240),
      mappingMode,
      targetUserIds,
      attendance: cleanAttendance,
    };
  });
}

function mapError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === 'SESSION_EXPIRED') return { status: 401, code: raw, message: 'Sesi tidak valid atau telah berakhir.' };
  if (raw === 'ACCOUNT_INACTIVE') return { status: 403, code: raw, message: 'Akun tidak aktif.' };
  if (raw === 'FORBIDDEN' || /Hanya SUPER ADMIN|di luar cakupan akun|Role belum diizinkan|Akses upload/i.test(raw)) return { status: 403, code: 'FORBIDDEN', message: raw === 'FORBIDDEN' ? 'Akses upload absensi tidak tersedia.' : raw };
  if (raw.startsWith('VALIDATION_') || /wajib|tidak dikenali|tidak valid|Format file|minimal|maksimal/i.test(raw)) return { status: 422, code: 'VALIDATION_ERROR', message: raw.startsWith('VALIDATION_') ? 'Payload import absensi tidak valid.' : raw };
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Layanan import absensi gagal memproses permintaan.' };
}

Deno.serve(async (req) => {
  const requestId = `IMP_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
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
    const { user, roleConfig } = await requireSession(String(body.token || ''));
    const scopes = await allowedScopes(user);
    const scopeNames = scopes.map((x: any) => x.SPPG);

    if (action === 'config') return json({ success: true, result: { roleConfig, scopes }, requestId }, 200, requestId);

    if (action === 'updateRoleConfig') {
      if (user.Role !== 'SUPER ADMIN') throw new Error('FORBIDDEN');
      const { role, config } = validateRoleConfig(body);
      const payload = { Role: role, ...config, Updated_By: user.ID_User, Updated_At: new Date().toISOString() };
      const { error } = await db.from('Attendance_Import_Role_Config').upsert(payload);
      if (error) throw new Error('ROLE_CONFIG_SAVE_FAILED');
      return json({ success: true, result: { updated: true, role }, requestId }, 200, requestId);
    }

    const sppg = String(body.sppg || '').trim();
    if (!sppg) throw new Error('VALIDATION_SPPG');
    if (!scopeNames.includes(sppg)) throw new Error('SPPG berada di luar cakupan akun.');

    if (action === 'preview') {
      const parsed = parseWorkbook(String(body.fileBase64 || ''));
      const { data: users, error: usersError } = await db.from('Users').select('ID_User,Nama_Lengkap,Jabatan_Divisi,SPPG').eq('SPPG', sppg).eq('Status_Aktif', true).order('Nama_Lengkap');
      if (usersError) throw new Error('USER_QUERY_FAILED');
      const { data: mappings, error: mappingError } = await db.from('Attendance_Name_Mappings').select('*').eq('SPPG', sppg).eq('Is_Active', true);
      if (mappingError) throw new Error('MAPPING_QUERY_FAILED');
      const grouped = new Map<string, any>();
      for (const row of parsed.rows) {
        const key = `${row.machineId}|${normalizeName(row.sourceName)}`;
        if (!grouped.has(key)) grouped.set(key, { machineId: row.machineId, sourceName: row.sourceName, department: row.department, attendance: [] });
        grouped.get(key).attendance.push({ date: row.date, scans: row.scans });
      }
      const employees = [...grouped.values()].map((employee) => {
        const saved = (mappings || []).find((m: any) => m.Source_Name_Normalized === normalizeName(employee.sourceName) && (!m.Source_Machine_ID || m.Source_Machine_ID === employee.machineId));
        const suggestions = (users || []).map((u: any) => ({ ...u, confidence: confidence(employee.sourceName, u.Nama_Lengkap || '') })).filter((u: any) => u.confidence >= 0.34).sort((a:any,b:any) => b.confidence-a.confidence).slice(0,5);
        return { ...employee, mappingMode: saved?.Mapping_Mode || 'SINGLE', targetUserIds: saved?.Target_User_IDs || (suggestions[0]?.confidence >= 0.66 ? [suggestions[0].ID_User] : []), suggestions, needsReview: !saved && !(suggestions[0]?.confidence >= 0.66) };
      });
      const accounts = (users || []).map((u: any) => ({ ID_User: u.ID_User, Nama_Lengkap: u.Nama_Lengkap, Jabatan_Divisi: u.Jabatan_Divisi }));
      return json({ success: true, result: { period: parsed.period, employees, accounts, summary: { employees: employees.length, scans: parsed.rows.reduce((n,r)=>n+r.scans.length,0), needsReview: employees.filter((e)=>e.needsReview).length } }, requestId }, 200, requestId);
    }

    if (action === 'commit') {
      const employees = validateCommitEmployees(body.employees);
      const allIds = [...new Set(employees.flatMap((e:any) => e.targetUserIds || []))];
      const { data: validUsers, error: validUsersError } = allIds.length
        ? await db.from('Users').select('ID_User,SPPG,Yayasan').in('ID_User', allIds).eq('SPPG', sppg).eq('Status_Aktif', true)
        : { data: [], error: null };
      if (validUsersError) throw new Error('USER_SCOPE_QUERY_FAILED');
      const valid = new Map((validUsers || []).map((u:any) => [u.ID_User,u]));
      if (allIds.some((id) => !valid.has(id))) throw new Error('Terdapat akun tujuan di luar cakupan SPPG.');
      const period = body.period && typeof body.period === 'object' && !Array.isArray(body.period) ? body.period : {};
      const duplicatePolicy = String(body.duplicatePolicy || 'SKIP').trim().toUpperCase();
      if (!['SKIP', 'FORCE'].includes(duplicatePolicy)) throw new Error('VALIDATION_DUPLICATE_POLICY');
      if (duplicatePolicy === 'FORCE' && !roleConfig.Can_Force_Duplicate) throw new Error('FORBIDDEN');
      const fileName = String(body.fileName || 'upload.xlsx').trim().slice(0, 240) || 'upload.xlsx';
      const fileHash = body.fileHash == null ? null : String(body.fileHash).trim().slice(0, 256) || null;
      const { data: job, error: jobError } = await db.from('Attendance_Import_Jobs').insert({ File_Name: fileName, File_Hash: fileHash, SPPG: sppg, Yayasan: scopes.find((x:any)=>x.SPPG===sppg)?.Yayasan || user.Yayasan, Period_Start: period.start || null, Period_End: period.end || null, Uploaded_By: user.ID_User, Status: 'PROCESSING', Total_Source_Employees: employees.length, Total_Target_Accounts: allIds.length, Import_Settings_JSON: { duplicatePolicy } }).select().single();
      if (jobError) throw new Error('IMPORT_JOB_CREATE_FAILED');
      let inserted = 0, skipped = 0, errors = 0, scansRead = 0;
      for (const employee of employees) {
        if (employee.mappingMode === 'IGNORE') continue;
        if (!employee.targetUserIds.length) { errors++; continue; }
        for (const day of employee.attendance) {
          const scans = day.scans; scansRead += scans.length;
          const { data: importRow, error: rowError } = await db.from('Attendance_Import_Rows').insert({ ID_Import: job.ID_Import, Machine_Employee_ID: employee.machineId, Source_Name: employee.sourceName, Source_Department: employee.department, Attendance_Date: day.date, Parsed_Scans_JSON: scans, Target_User_IDs: employee.targetUserIds, Validation_Status: 'VALID' }).select().single();
          if (rowError) { errors++; console.error(JSON.stringify({ requestId, code: 'IMPORT_ROW_INSERT_FAILED', error: rowError.message })); continue; }
          for (const userId of employee.targetUserIds) for (let i=0;i<scans.length;i++) {
            const kind = scans.length === 1 ? 'PUNCH_TUNGGAL' : i === 0 ? 'DATANG' : i === scans.length - 1 ? 'PULANG' : 'PUNCH_TAMBAHAN';
            const stamp = `${day.date}T${scans[i]}:00+07:00`;
            const row = { ID_Absen: crypto.randomUUID(), ID_User: userId, Tanggal: day.date, Jenis_Absen: kind, Waktu_Timestamp: stamp, Status_Validasi: 'VALID', SPPG: sppg, Yayasan: valid.get(userId)?.Yayasan || user.Yayasan, Sumber_Data: 'IMPORT_FILE_ABSENSI', Nama_Impor: employee.sourceName, Dept_Impor: employee.department, Urutan_Punch: i+1, Waktu_Asli_Impor: scans[i], Catatan_Validasi: 'Validasi administratif: upload file absensi.', File_Impor: fileName, ID_Import: job.ID_Import, ID_Import_Row: importRow?.ID_Import_Row, Mapping_Mode: employee.mappingMode };
            const { error } = await db.from('Absensi').insert(row);
            if (error?.code === '23505') skipped++; else if (error) { errors++; console.error(JSON.stringify({ requestId, code: 'ATTENDANCE_IMPORT_INSERT_FAILED', error: error.message })); } else inserted++;
          }
        }
        if (body.saveMappings === true && roleConfig.Can_Save_Mapping) {
          const { error } = await db.from('Attendance_Name_Mappings').upsert({ SPPG: sppg, Source_Name_Normalized: normalizeName(employee.sourceName), Source_Machine_ID: employee.machineId || null, Source_Department: employee.department, Mapping_Mode: employee.mappingMode, Target_User_IDs: employee.targetUserIds, Is_Active: true, Created_By: user.ID_User, Updated_At: new Date().toISOString() }, { onConflict: 'SPPG,Source_Name_Normalized,Source_Machine_ID' });
          if (error) { errors++; console.error(JSON.stringify({ requestId, code: 'MAPPING_SAVE_FAILED', error: error.message })); }
        }
      }
      const status = errors ? (inserted ? 'PARTIAL' : 'FAILED') : 'COMPLETED';
      const finalUpdate = await db.from('Attendance_Import_Jobs').update({ Status: status, Total_Scans_Read: scansRead, Total_Scans_Inserted: inserted, Total_Scans_Skipped: skipped, Total_Errors: errors, Completed_At: new Date().toISOString() }).eq('ID_Import', job.ID_Import);
      const finalizationWarning = Boolean(finalUpdate.error);
      if (finalUpdate.error) console.error(JSON.stringify({ requestId, code: 'IMPORT_JOB_FINALIZE_FAILED', importId: job.ID_Import, error: finalUpdate.error.message }));
      return json({ success: true, result: { importId: job.ID_Import, status, inserted, skipped, errors, scansRead, finalizationWarning }, requestId }, 200, requestId);
    }

    return json({ success: false, code: 'ACTION_NOT_SUPPORTED', message: 'Aksi tidak dikenali.', requestId }, 422, requestId);
  } catch (error) {
    const mapped = mapError(error);
    console.error(JSON.stringify({ requestId, code: mapped.code, status: mapped.status, error: error instanceof Error ? error.message : String(error) }));
    return json({ success: false, code: mapped.code, message: mapped.message, requestId }, mapped.status, requestId);
  }
});