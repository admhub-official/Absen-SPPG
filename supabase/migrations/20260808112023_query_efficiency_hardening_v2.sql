create or replace function public.get_absensi_grouped_page_v2(
  p_user_ids text[], p_page integer default 1, p_page_size integer default 20,
  p_search text default null, p_start_date date default null, p_end_date date default null,
  p_sppg text default null, p_status text default null, p_source text default null
)
returns table(row_data jsonb, total_count bigint)
language sql stable set search_path=''
as $function$
with grouped as (
  select a."ID_User",u."Nama_Lengkap",u."SPPG",a."Tanggal",
    min(a."Waktu_Timestamp") filter (where a."Jenis_Absen"='DATANG') datang_ts,
    max(a."Waktu_Timestamp") filter (where a."Jenis_Absen"='PULANG') pulang_ts,
    min(a."Waktu_Timestamp") filter (where a."Jenis_Absen"='PUNCH_TUNGGAL') tunggal_ts,
    count(*) punch_count,
    bool_or(a."Jenis_Absen"='PUNCH_TUNGGAL') has_single_punch,
    array_agg(distinct upper(coalesce(nullif(trim(a."Sumber_Data"),''),'APLIKASI'))) source_values,
    jsonb_agg(jsonb_build_object('waktu',to_char(a."Waktu_Timestamp" at time zone 'Asia/Jakarta','HH24:MI:SS'),'jenis',a."Jenis_Absen",'status',a."Status_Validasi",'sumber',coalesce(nullif(trim(a."Sumber_Data"),''),'APLIKASI')) order by a."Waktu_Timestamp",coalesce(a."Urutan_Punch",0)) punches,
    to_jsonb(array_agg(distinct coalesce(nullif(trim(a."Sumber_Data"),''),'APLIKASI'))) sumber
  from public."Absensi" a join public."Users" u on u."ID_User"=a."ID_User"
  where a."ID_User"=any(coalesce(p_user_ids,array[]::text[]))
    and (p_start_date is null or a."Tanggal">=p_start_date)
    and (p_end_date is null or a."Tanggal"<=p_end_date)
    and (nullif(trim(coalesce(p_sppg,'')),'') is null or upper(trim(u."SPPG"))=upper(trim(p_sppg)))
    and (nullif(trim(coalesce(p_search,'')),'') is null or u."Nama_Lengkap" ilike '%'||trim(p_search)||'%' or u."SPPG" ilike '%'||trim(p_search)||'%' or u."Jabatan_Divisi" ilike '%'||trim(p_search)||'%' or a."Tanggal"::text ilike '%'||trim(p_search)||'%')
  group by a."ID_User",u."Nama_Lengkap",u."SPPG",a."Tanggal"
), filtered as (
  select * from grouped g where
    (nullif(trim(coalesce(p_source,'')),'') is null or upper(trim(p_source))=any(g.source_values))
    and (
      nullif(trim(coalesce(p_status,'')),'') is null
      or (upper(trim(p_status))='LENGKAP' and g.datang_ts is not null and g.pulang_ts is not null)
      or (upper(trim(p_status))='PUNCH_TUNGGAL' and (g.punch_count=1 or g.has_single_punch))
      or (upper(trim(p_status))='BELUM_LENGKAP' and not (g.punch_count=1 or g.has_single_punch) and (g.datang_ts is null or g.pulang_ts is null))
    )
), paged as (
  select f.*,count(*) over() full_count from filtered f
  order by f."Tanggal" desc,f."Nama_Lengkap"
  offset ((greatest(coalesce(p_page,1),1)-1)*least(greatest(coalesce(p_page_size,20),1),100))
  limit least(greatest(coalesce(p_page_size,20),1),100)
)
select jsonb_build_object('ID_User',p."ID_User",'namaLengkap',p."Nama_Lengkap",'sppg',p."SPPG",'Tanggal',p."Tanggal",'jamMasuk',to_char(coalesce(p.datang_ts,p.tunggal_ts) at time zone 'Asia/Jakarta','HH24:MI:SS'),'jamPulang',to_char(p.pulang_ts at time zone 'Asia/Jakarta','HH24:MI:SS'),'statusMasuk',case when coalesce(p.datang_ts,p.tunggal_ts) is not null then 'VALID' end,'statusPulang',case when p.pulang_ts is not null then 'VALID' end,'punches',p.punches,'sumber',p.sumber),p.full_count from paged p;
$function$;

create or replace function public.get_my_absensi_grouped(p_user_id text,p_month text default null)
returns jsonb language sql stable set search_path=''
as $function$
with grouped as (
 select a."Tanggal",
 min(a."Waktu_Timestamp") filter(where a."Jenis_Absen"='DATANG') datang_ts,
 max(a."Waktu_Timestamp") filter(where a."Jenis_Absen"='PULANG') pulang_ts,
 bool_or(a."Jenis_Absen"='PUNCH_TUNGGAL') has_single,count(*) punch_count,
 jsonb_agg(jsonb_build_object('waktu',to_char(a."Waktu_Timestamp" at time zone 'Asia/Jakarta','HH24:MI:SS'),'timestamp',a."Waktu_Timestamp",'jenis',a."Jenis_Absen",'sumber',coalesce(nullif(trim(a."Sumber_Data"),''),'APLIKASI'),'urutan',a."Urutan_Punch") order by a."Waktu_Timestamp",coalesce(a."Urutan_Punch",0)) punches
 from public."Absensi" a where a."ID_User"=p_user_id and a."Status_Validasi"='VALID'
 and (nullif(trim(coalesce(p_month,'')),'') is null or to_char(a."Tanggal",'YYYY-MM')=trim(p_month)) group by a."Tanggal"
), shaped as (select g.*,(g.datang_ts is not null and g.pulang_ts is not null) lengkap,(g.punch_count=1 or g.has_single) is_single from grouped g)
select jsonb_build_object(
 'rows',coalesce((select jsonb_agg(jsonb_build_object('tanggal',s."Tanggal",'datang',coalesce(to_char(s.datang_ts at time zone 'Asia/Jakarta','HH24:MI:SS'),case when s.is_single then s.punches->0->>'waktu' end),'pulang',to_char(s.pulang_ts at time zone 'Asia/Jakarta','HH24:MI:SS'),'punches',s.punches,'lengkap',s.lengkap,'status',case when s.lengkap then 'LENGKAP' when s.is_single then 'PUNCH_TUNGGAL_VALID' else 'BELUM_LENGKAP' end) order by s."Tanggal" desc) from shaped s),'[]'::jsonb),
 'totalHariKerja',(select count(*) from shaped where lengkap),
 'totalDatang',(select count(*) from shaped where datang_ts is not null or is_single),
 'totalPulang',(select count(*) from shaped where pulang_ts is not null));
$function$;

create or replace function public.get_user_dashboard_summary(p_user_id text)
returns jsonb language sql stable set search_path=''
as $function$
with valid_attendance as materialized (
 select a."Tanggal",a."Jenis_Absen",a."Waktu_Timestamp",a."Status_Validasi" from public."Absensi" a where a."ID_User"=p_user_id and a."Status_Validasi"='VALID'
), days as (select v."Tanggal",bool_or(v."Jenis_Absen"='DATANG') has_datang,bool_or(v."Jenis_Absen"='PULANG') has_pulang from valid_attendance v group by v."Tanggal"),
recent as (select v.* from valid_attendance v order by v."Waktu_Timestamp" desc limit 10),
slip_summary as (select count(*)::bigint total_slip,coalesce(sum(s."Total_Gaji_Diterima"),0)::numeric total_gaji from public."Slip_Gaji" s where s."ID_User"=p_user_id)
select jsonb_build_object('role','USER','totalHariKerja',coalesce((select count(*) from days where has_datang and has_pulang),0),'totalSlip',coalesce((select total_slip from slip_summary),0),'totalGajiDiterima',coalesce((select total_gaji from slip_summary),0),'riwayat',coalesce((select jsonb_agg(jsonb_build_object('tanggal',r."Tanggal",'jenis',r."Jenis_Absen",'waktu',to_char(r."Waktu_Timestamp" at time zone 'Asia/Jakarta','HH24:MI:SS'),'status',r."Status_Validasi") order by r."Waktu_Timestamp" desc) from recent r),'[]'::jsonb),'sudahDatang',exists(select 1 from valid_attendance v where v."Tanggal"=(now() at time zone 'Asia/Jakarta')::date and v."Jenis_Absen"='DATANG'),'sudahPulang',exists(select 1 from valid_attendance v where v."Tanggal"=(now() at time zone 'Asia/Jakarta')::date and v."Jenis_Absen"='PULANG'));
$function$;

create or replace function public.commit_attendance_import_batch(p_import uuid,p_sppg text,p_default_yayasan text,p_file_name text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_source_scans integer:=0; v_attempted integer:=0; v_inserted integer:=0;
begin
 if jsonb_typeof(coalesce(p_rows,'[]'::jsonb))<>'array' then raise exception 'INVALID_IMPORT_ROWS'; end if;
 with employee_days as (
  select gen_random_uuid() id_import_row,nullif(trim(emp->>'machineId'),'') machine_id,coalesce(emp->>'sourceName','') source_name,nullif(trim(emp->>'department'),'') source_department,upper(coalesce(nullif(trim(emp->>'mappingMode'),''),'SINGLE')) mapping_mode,coalesce(array(select jsonb_array_elements_text(coalesce(emp->'targetUserIds','[]'::jsonb))),array[]::text[]) target_user_ids,(day->>'date')::date attendance_date,coalesce(day->'scans','[]'::jsonb) scans
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) emp cross join lateral jsonb_array_elements(coalesce(emp->'attendance','[]'::jsonb)) day where upper(coalesce(nullif(trim(emp->>'mappingMode'),''),'SINGLE'))<>'IGNORE'
 ), inserted_rows as (
  insert into public."Attendance_Import_Rows"("ID_Import_Row","ID_Import","Machine_Employee_ID","Source_Name","Source_Department","Attendance_Date","Parsed_Scans_JSON","Target_User_IDs","Validation_Status")
  select d.id_import_row,p_import,d.machine_id,d.source_name,d.source_department,d.attendance_date,d.scans,d.target_user_ids,'VALID' from employee_days d
  returning "ID_Import_Row","Machine_Employee_ID","Source_Name","Source_Department","Attendance_Date","Parsed_Scans_JSON","Target_User_IDs"
 ), stats as (
  select coalesce(sum(jsonb_array_length(r."Parsed_Scans_JSON")),0)::integer source_scans,coalesce(sum(cardinality(r."Target_User_IDs")*jsonb_array_length(r."Parsed_Scans_JSON")),0)::integer attempted from inserted_rows r
 ), expanded as (
  select r."ID_Import_Row",r."Source_Name",r."Source_Department",r."Attendance_Date",target_user id_user,scan.scan_time,scan.ordinality::integer ordinality,jsonb_array_length(r."Parsed_Scans_JSON") scan_count,cardinality(r."Target_User_IDs") target_count
  from inserted_rows r cross join lateral unnest(r."Target_User_IDs") target_user cross join lateral jsonb_array_elements_text(r."Parsed_Scans_JSON") with ordinality as scan(scan_time,ordinality)
 ), inserted_attendance as (
  insert into public."Absensi"("ID_Absen","ID_User","Tanggal","Jenis_Absen","Waktu_Timestamp","Status_Validasi","SPPG","Yayasan","Sumber_Data","Nama_Impor","Dept_Impor","Urutan_Punch","Waktu_Asli_Impor","Catatan_Validasi","File_Impor","ID_Import","ID_Import_Row","Mapping_Mode")
  select gen_random_uuid()::text,e.id_user,e."Attendance_Date",case when e.scan_count=1 then 'PUNCH_TUNGGAL' when e.ordinality=1 then 'DATANG' when e.ordinality=e.scan_count then 'PULANG' else 'PUNCH_TAMBAHAN' end,(e."Attendance_Date"::text||'T'||e.scan_time||':00+07:00')::timestamptz,'VALID',p_sppg,coalesce(u."Yayasan",p_default_yayasan),'IMPORT_FILE_ABSENSI',e."Source_Name",e."Source_Department",e.ordinality,e.scan_time,'Validasi administratif: upload file absensi.',p_file_name,p_import,e."ID_Import_Row",case when e.target_count>1 then 'COPY_TO_MULTIPLE' else 'SINGLE' end
  from expanded e left join public."Users" u on u."ID_User"=e.id_user
  on conflict ("ID_User","Tanggal","Waktu_Timestamp","Sumber_Data") where "Sumber_Data"='IMPORT_FILE_ABSENSI' do nothing returning 1
 ) select s.source_scans,s.attempted,(select count(*)::integer from inserted_attendance) into v_source_scans,v_attempted,v_inserted from stats s;
 return jsonb_build_object('scansRead',coalesce(v_source_scans,0),'attempted',coalesce(v_attempted,0),'inserted',coalesce(v_inserted,0),'skipped',greatest(coalesce(v_attempted,0)-coalesce(v_inserted,0),0));
end;$function$;

revoke all on function public.commit_attendance_import_batch(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_attendance_import_batch(uuid,text,text,text,jsonb) to service_role;
