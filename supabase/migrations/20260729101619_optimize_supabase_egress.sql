-- Aggregate dashboard data inside Postgres. The previous Edge Function downloaded
-- every historical slip, complaint, session, and user row on each refresh.
create or replace function public.get_super_admin_overview_v4(
  p_today date default (timezone('Asia/Jakarta', now()))::date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with active_users as (
  select
    u."ID_User",
    u."Nama_Lengkap",
    u."Role",
    coalesce(nullif(trim(u."SPPG"), ''), 'Tanpa SPPG') as sppg,
    u."Jabatan_Divisi",
    u."Gaji_Harian",
    u."Nama_Bank",
    u."Nomor_Rekening",
    u."URL_Foto_Wajah_Ref"
  from public."Users" u
  where u."Status_Aktif" is true
),
today_attendance as (
  select
    a."ID_User",
    max(case when upper(coalesce(a."Jenis_Absen", '')) in ('PULANG', 'KELUAR') then 1 else 0 end) as complete
  from public."Absensi" a
  where a."Tanggal" = p_today
  group by a."ID_User"
),
slip_by_sppg as (
  select
    coalesce(nullif(trim(s."SPPG"), ''), 'Tanpa SPPG') as sppg,
    coalesce(sum(s."Total_Gaji_Diterima"), 0) as payroll_total,
    count(*) filter (where s."Ditandatangani_Penerima_At" is null) as pending_slips
  from public."Slip_Gaji" s
  group by 1
),
complaint_by_sppg as (
  select
    coalesce(nullif(trim(p."SPPG"), ''), 'Tanpa SPPG') as sppg,
    count(*) filter (where coalesce(p."Status_Tiket", 'BARU') <> 'SELESAI') as open_complaints
  from public."Pengaduan" p
  group by 1
),
sppg_rows as (
  select
    u.sppg,
    count(*) as employees,
    count(a."ID_User") as present,
    count(*) filter (where a.complete = 1) as complete,
    coalesce(max(s.payroll_total), 0) as payroll_total,
    coalesce(max(s.pending_slips), 0) as pending_slips,
    coalesce(max(c.open_complaints), 0) as open_complaints
  from active_users u
  left join today_attendance a on a."ID_User" = u."ID_User"
  left join slip_by_sppg s on s.sppg = u.sppg
  left join complaint_by_sppg c on c.sppg = u.sppg
  group by u.sppg
),
duplicate_names as (
  select min(u."Nama_Lengkap") as label, count(*) as count
  from active_users u
  where nullif(trim(u."Nama_Lengkap"), '') is not null
  group by lower(regexp_replace(trim(u."Nama_Lengkap"), '\s+', ' ', 'g'))
  having count(*) > 1
  order by count(*) desc, min(u."Nama_Lengkap")
  limit 50
),
without_division as (
  select u."ID_User" as id, u."Nama_Lengkap" as name, u.sppg
  from active_users u
  where nullif(trim(u."Jabatan_Divisi"), '') is null
  order by u."Nama_Lengkap"
  limit 50
),
without_salary as (
  select u."ID_User" as id, u."Nama_Lengkap" as name, u.sppg
  from active_users u
  where coalesce(u."Gaji_Harian", 0) <= 0
  order by u."Nama_Lengkap"
  limit 50
),
without_bank as (
  select u."ID_User" as id, u."Nama_Lengkap" as name, u.sppg
  from active_users u
  where nullif(trim(u."Nama_Bank"), '') is null
     or nullif(trim(u."Nomor_Rekening"), '') is null
  order by u."Nama_Lengkap"
  limit 50
),
without_face as (
  select u."ID_User" as id, u."Nama_Lengkap" as name, u.sppg
  from active_users u
  where nullif(trim(u."URL_Foto_Wajah_Ref"), '') is null
  order by u."Nama_Lengkap"
  limit 50
),
slips_without_pdf as (
  select s."ID_Slip" as id, coalesce(nullif(trim(s."SPPG"), ''), 'Tanpa SPPG') as sppg
  from public."Slip_Gaji" s
  where nullif(trim(s."URL_PDF_Slip"), '') is null
    and nullif(trim(s."PDF_Storage_Path"), '') is null
  order by s."Diterbitkan_At" desc nulls last
  limit 50
),
inactive_with_session as (
  select distinct s."ID_User" as id
  from public."Sessions" s
  left join public."Users" u on u."ID_User" = s."ID_User"
  where s."Expires_At" > now()
    and coalesce(u."Status_Aktif", false) is false
  limit 50
),
settings as (
  select coalesce(jsonb_agg(to_jsonb(s) order by s."Setting_Key"), '[]'::jsonb) as rows
  from public."System_Settings" s
)
select jsonb_build_object(
  'totals', jsonb_build_object(
    'sppg', (select count(*) from sppg_rows),
    'employees', (select count(*) from active_users),
    'admins', (select count(*) from active_users where upper(coalesce("Role", '')) in ('ADMIN', 'AKUNTAN')),
    'attendanceRate', coalesce((
      select round(100.0 * count(a."ID_User") / nullif(count(u."ID_User"), 0))
      from active_users u left join today_attendance a on a."ID_User" = u."ID_User"
    ), 0),
    'payrollTotal', coalesce((select sum("Total_Gaji_Diterima") from public."Slip_Gaji"), 0),
    'pendingSlips', (select count(*) from public."Slip_Gaji" where "Ditandatangani_Penerima_At" is null),
    'openComplaints', (select count(*) from public."Pengaduan" where coalesce("Status_Tiket", 'BARU') <> 'SELESAI')
  ),
  'bySppg', coalesce((
    select jsonb_agg(jsonb_build_object(
      'sppg', r.sppg,
      'employees', r.employees,
      'present', r.present,
      'attendanceRate', coalesce(round(100.0 * r.present / nullif(r.employees, 0)), 0),
      'completePunchRate', coalesce(round(100.0 * r.complete / nullif(r.present, 0)), 0),
      'payrollTotal', r.payroll_total,
      'pendingSlips', r.pending_slips,
      'openComplaints', r.open_complaints
    ) order by r.sppg)
    from sppg_rows r
  ), '[]'::jsonb),
  'quality', jsonb_build_object(
    'duplicateNames', coalesce((select jsonb_agg(to_jsonb(x)) from duplicate_names x), '[]'::jsonb),
    'withoutDivision', coalesce((select jsonb_agg(to_jsonb(x)) from without_division x), '[]'::jsonb),
    'withoutSalary', coalesce((select jsonb_agg(to_jsonb(x)) from without_salary x), '[]'::jsonb),
    'withoutBank', coalesce((select jsonb_agg(to_jsonb(x)) from without_bank x), '[]'::jsonb),
    'withoutFace', coalesce((select jsonb_agg(to_jsonb(x)) from without_face x), '[]'::jsonb),
    'slipsWithoutPdf', coalesce((select jsonb_agg(to_jsonb(x)) from slips_without_pdf x), '[]'::jsonb),
    'inactiveWithSession', coalesce((select jsonb_agg(to_jsonb(x)) from inactive_with_session x), '[]'::jsonb)
  ),
  'settings', (select rows from settings)
);
$$;

revoke all on function public.get_super_admin_overview_v4(date) from public, anon, authenticated;
grant execute on function public.get_super_admin_overview_v4(date) to service_role;
