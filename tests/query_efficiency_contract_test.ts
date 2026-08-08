import { assert, assertEquals } from "jsr:@std/assert@1";

const read = (path: string) => Deno.readTextFile(path);

Deno.test("attendance menu delegates filtering and pagination to one SQL RPC", async () => {
  const source = await read("supabase/functions/OperationsV2/index.ts");
  assert(source.includes('db.rpc("get_absensi_grouped_page_v2"'));
  assert(!source.includes("async function allGroupedAttendance("));
  assert(source.includes("p_start_date: startDate || null"));
  assert(source.includes("p_status: status || null"));
  assert(source.includes("p_source: source || null"));
});

Deno.test("attendance import uses one batch RPC instead of per-punch inserts", async () => {
  const source = await read("supabase/functions/AttendanceImport/index.ts");
  assert(source.includes("db.rpc('commit_attendance_import_batch'"));
  assert(!source.includes("db.from('Absensi').insert(row)"));
  assert(source.includes("upsert(mappingRows"));
});

Deno.test("user attendance and dashboard use SQL aggregation at the public gateway", async () => {
  const source = await read("supabase/functions/Absen/proxy.ts");
  assert(source.includes("db.rpc('get_my_absensi_grouped'"));
  assert(source.includes("db.rpc('get_user_dashboard_summary'"));
  assertEquals((source.match(/functionName === 'getMyAbsensi'/g) || []).length, 1);
});

Deno.test("query efficiency database helpers are tracked in the migration history", async () => {
  const migration = await read("supabase/migrations/20260808112023_query_efficiency_hardening_v2.sql");
  assert(migration.includes("get_absensi_grouped_page_v2"));
  assert(migration.includes("get_my_absensi_grouped"));
  assert(migration.includes("get_user_dashboard_summary"));
  assert(migration.includes("commit_attendance_import_batch"));
  assert(migration.includes("grant execute on function public.commit_attendance_import_batch"));
});

Deno.test("active admin KPI, audit, payroll and notification paths avoid row overfetch", async () => {
  const operations = await read("supabase/functions/OperationsV2/index.ts");
  const proxy = await read("supabase/functions/Absen/proxy.ts");
  const migration = await read("supabase/migrations/20260808113400_query_efficiency_active_path_followup.sql");
  assert(operations.includes('db.rpc("get_operational_dashboard_counts"'));
  assert(!operations.includes('.select("ID_Pengaduan,SPPG,Status_Tiket").limit(5000)'));
  assert(proxy.includes("async function optimizedAuditLog"));
  assert(proxy.includes("functionName === 'getAuditLogEnriched'"));
  assert(proxy.includes("select('ID_Log,Waktu,ID_User_Pelaku,Jenis_Aktivitas,Detail,IP_Address')"));
  assert(proxy.includes("async function optimizedSlipList"));
  assert(proxy.includes("functionName === 'getAllSlipGajiList'"));
  assert(proxy.includes("select('ID_User,Nama_Lengkap,SPPG')"));
  assert(!proxy.includes(".from('App_Notifications')\n    .select('*')"));
  assert(migration.includes("get_operational_dashboard_counts"));
});
