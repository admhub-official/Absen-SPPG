import { createClient } from 'npm:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

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
function parseWorkbook(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
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
  const { data: session, error: sessionError } = await db.from('Sessions').select('ID_User,Role,Expires_At').eq('Token', token).gt('Expires_At', new Date().toISOString()).maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) throw new Error('Sesi tidak valid atau telah berakhir.');
  const { data: user, error: userError } = await db.from('Users').select('ID_User,Nama_Lengkap,Role,SPPG,Yayasan,Status_Aktif').eq('ID_User', session.ID_User).single();
  if (userError) throw userError;
  user.Role = normalizeName(user.Role);
  if (!user?.Status_Aktif || user.Role === 'USER') throw new Error('Akses upload absensi tidak tersedia.');
  const { data: roleConfig, error: roleError } = await db.from('Attendance_Import_Role_Config').select('*').eq('Role', user.Role).maybeSingle();
  if (roleError) throw roleError;
  if (!roleConfig?.Menu_Enabled || !roleConfig?.Can_Upload) throw new Error('Role belum diizinkan mengunggah data absensi.');
  return { user, roleConfig };
}
async function allowedScopes(user: any) {
  if (user.Role === 'SUPER ADMIN') {
    const { data, error } = await db.from('Users').select('SPPG,Yayasan').not('SPPG', 'is', null);
    if (error) throw error;
    return [...new Map((data || []).filter((x) => x.SPPG).map((x) => [x.SPPG, x])).values()];
  }
  const { data, error } = await db.from('Admin_Access').select('SPPG,Yayasan').eq('ID_User_Admin', user.ID_User).eq('Aktif', true);
  if (error) throw error;
  const scopes = [...(data || [])];
  if (user.SPPG && !scopes.some((x) => x.SPPG === user.SPPG)) scopes.push({ SPPG: user.SPPG, Yayasan: user.Yayasan });
  return scopes;
}
function confidence(source: string, target: string) { const a = new Set(normalizeName(source).split(' ')); const b = new Set(normalizeName(target).split(' ')); const intersection = [...a].filter((x) => b.has(x)).length; return intersection / Math.max(a.size, b.size, 1); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    const body = await req.json();
    const { user, roleConfig } = await requireSession(String(body.token || ''));
    const scopes = await allowedScopes(user);
    const scopeNames = scopes.map((x: any) => x.SPPG);
    if (body.action === 'config') return json({ success: true, result: { roleConfig, scopes } });
    if (body.action === 'updateRoleConfig') {
      if (user.Role !== 'SUPER ADMIN') throw new Error('Hanya SUPER ADMIN yang dapat mengatur role.');
      const role = normalizeName(String(body.role || ''));
      if (role === 'USER') body.config = { Menu_Enabled: false, Can_Upload: false, Can_Save_Mapping: false, Can_Force_Duplicate: false };
      const payload = { Role: role, ...body.config, Updated_By: user.ID_User, Updated_At: new Date().toISOString() };
      const { error } = await db.from('Attendance_Import_Role_Config').upsert(payload);
      if (error) throw error;
      return json({ success: true });
    }
    const sppg = String(body.sppg || '');
    if (!scopeNames.includes(sppg)) throw new Error('SPPG berada di luar cakupan akun.');
    if (body.action === 'preview') {
      const parsed = parseWorkbook(String(body.fileBase64 || ''));
      const { data: users, error: usersError } = await db.from('Users').select('ID_User,Nama_Lengkap,Jabatan_Divisi,SPPG').eq('SPPG', sppg).eq('Status_Aktif', true).order('Nama_Lengkap');
      if (usersError) throw usersError;
      const { data: mappings, error: mappingError } = await db.from('Attendance_Name_Mappings').select('*').eq('SPPG', sppg).eq('Is_Active', true);
      if (mappingError) throw mappingError;
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
      return json({ success: true, result: { period: parsed.period, employees, accounts, summary: { employees: employees.length, scans: parsed.rows.reduce((n,r)=>n+r.scans.length,0), needsReview: employees.filter((e)=>e.needsReview).length } } });
    }
    if (body.action === 'commit') {
      const employees = Array.isArray(body.employees) ? body.employees : [];
      const invalidMulti = employees.some((e: any) => e.mappingMode === 'COPY_TO_MULTIPLE' && (e.targetUserIds || []).length < 2);
      if (invalidMulti) throw new Error('Pemetaan beberapa akun wajib memilih minimal dua akun tujuan.');
      const allIds = [...new Set(employees.flatMap((e:any) => e.targetUserIds || []))];
      const { data: validUsers, error: validUsersError } = await db.from('Users').select('ID_User,SPPG,Yayasan').in('ID_User', allIds).eq('SPPG', sppg).eq('Status_Aktif', true);
      if (validUsersError) throw validUsersError;
      const valid = new Map((validUsers || []).map((u:any) => [u.ID_User,u]));
      if (allIds.some((id) => !valid.has(id))) throw new Error('Terdapat akun tujuan di luar cakupan SPPG.');
      const { data: job, error: jobError } = await db.from('Attendance_Import_Jobs').insert({ File_Name: body.fileName || 'upload.xlsx', File_Hash: body.fileHash || null, SPPG: sppg, Yayasan: scopes.find((x:any)=>x.SPPG===sppg)?.Yayasan || user.Yayasan, Period_Start: body.period?.start || null, Period_End: body.period?.end || null, Uploaded_By: user.ID_User, Status: 'PROCESSING', Total_Source_Employees: employees.length, Total_Target_Accounts: allIds.length, Import_Settings_JSON: { duplicatePolicy: body.duplicatePolicy || 'SKIP' } }).select().single();
      if (jobError) throw jobError;
      let inserted = 0, skipped = 0, errors = 0, scansRead = 0;
      for (const employee of employees) {
        if (employee.mappingMode === 'IGNORE') continue;
        if (!employee.targetUserIds?.length) { errors++; continue; }
        for (const day of employee.attendance || []) {
          const scans = day.scans || []; scansRead += scans.length;
          const { data: importRow, error: rowError } = await db.from('Attendance_Import_Rows').insert({ ID_Import: job.ID_Import, Machine_Employee_ID: employee.machineId, Source_Name: employee.sourceName, Source_Department: employee.department, Attendance_Date: day.date, Parsed_Scans_JSON: scans, Target_User_IDs: employee.targetUserIds, Validation_Status: 'VALID' }).select().single();
          if (rowError) { errors++; continue; }
          for (const userId of employee.targetUserIds) for (let i=0;i<scans.length;i++) {
            const kind = scans.length === 1 ? 'PUNCH_TUNGGAL' : i === 0 ? 'DATANG' : i === scans.length - 1 ? 'PULANG' : 'PUNCH_TAMBAHAN';
            const stamp = `${day.date}T${scans[i]}:00+07:00`;
            const row = { ID_Absen: crypto.randomUUID(), ID_User: userId, Tanggal: day.date, Jenis_Absen: kind, Waktu_Timestamp: stamp, Status_Validasi: 'VALID', SPPG: sppg, Yayasan: valid.get(userId)?.Yayasan || user.Yayasan, Sumber_Data: 'IMPORT_FILE_ABSENSI', Nama_Impor: employee.sourceName, Dept_Impor: employee.department, Urutan_Punch: i+1, Waktu_Asli_Impor: scans[i], Catatan_Validasi: 'Validasi administratif: upload file absensi.', File_Impor: body.fileName || null, ID_Import: job.ID_Import, ID_Import_Row: importRow?.ID_Import_Row, Mapping_Mode: employee.mappingMode };
            const { error } = await db.from('Absensi').insert(row);
            if (error?.code === '23505') skipped++; else if (error) errors++; else inserted++;
          }
        }
        if (body.saveMappings && roleConfig.Can_Save_Mapping) {
          const { error } = await db.from('Attendance_Name_Mappings').upsert({ SPPG: sppg, Source_Name_Normalized: normalizeName(employee.sourceName), Source_Machine_ID: employee.machineId || null, Source_Department: employee.department, Mapping_Mode: employee.mappingMode, Target_User_IDs: employee.targetUserIds, Is_Active: true, Created_By: user.ID_User, Updated_At: new Date().toISOString() }, { onConflict: 'SPPG,Source_Name_Normalized,Source_Machine_ID' });
          if (error) errors++;
        }
      }
      const status = errors ? (inserted ? 'PARTIAL' : 'FAILED') : 'COMPLETED';
      await db.from('Attendance_Import_Jobs').update({ Status: status, Total_Scans_Read: scansRead, Total_Scans_Inserted: inserted, Total_Scans_Skipped: skipped, Total_Errors: errors, Completed_At: new Date().toISOString() }).eq('ID_Import', job.ID_Import);
      return json({ success: true, result: { importId: job.ID_Import, status, inserted, skipped, errors, scansRead } });
    }
    throw new Error('Aksi tidak dikenali.');
  } catch (error) {
    console.error(error);
    return json({ success: false, message: error instanceof Error ? error.message : 'Terjadi kesalahan.' }, 400);
  }
});
