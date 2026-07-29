create or replace function public.get_absensi_grouped_page_v2(
  p_user_ids text[],
  p_page integer default 1,
  p_page_size integer default 20,
  p_search text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_sppg text default null,
  p_status text default null,
  p_source text default null
)
returns table(row_data jsonb, total_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with grouped as (
    select
      a."ID_User",
      u."Nama_Lengkap",
      u."SPPG",
      a."Tanggal",
      min(a."Waktu_Timestamp") filter (where a."Jenis_Absen" = 'DATANG') as datang_ts,
      max(a."Waktu_Timestamp") filter (where a."Jenis_Absen" = 'PULANG') as pulang_ts,
      min(a."Waktu_Timestamp") filter (where a."Jenis_Absen" = 'PUNCH_TUNGGAL') as tunggal_ts,
      bool_or(a."Jenis_Absen" = 'PUNCH_TUNGGAL') as has_single_punch,
      jsonb_agg(
        jsonb_build_object(
          'waktu', to_char(a."Waktu_Timestamp" at time zone 'Asia/Jakarta', 'HH24:MI:SS'),
          'jenis', a."Jenis_Absen",
          'status', a."Status_Validasi"
        )
        order by a."Waktu_Timestamp", coalesce(a."Urutan_Punch", 0)
      ) as punches,
      to_jsonb(array_agg(distinct coalesce(a."Sumber_Data", 'APLIKASI'))) as sumber
    from public."Absensi" a
    join public."Users" u on u."ID_User" = a."ID_User"
    where a."ID_User" = any(coalesce(p_user_ids, array[]::text[]))
      and (p_start_date is null or a."Tanggal" >= p_start_date)
      and (p_end_date is null or a."Tanggal" <= p_end_date)
      and (nullif(trim(coalesce(p_sppg, '')), '') is null or upper(trim(u."SPPG")) = upper(trim(p_sppg)))
      and (
        nullif(trim(coalesce(p_source, '')), '') is null
        or coalesce(a."Sumber_Data", 'APLIKASI') = trim(p_source)
      )
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or u."Nama_Lengkap" ilike '%' || trim(p_search) || '%'
        or u."SPPG" ilike '%' || trim(p_search) || '%'
        or u."Jabatan_Divisi" ilike '%' || trim(p_search) || '%'
        or a."Tanggal"::text ilike '%' || trim(p_search) || '%'
      )
    group by a."ID_User", u."Nama_Lengkap", u."SPPG", a."Tanggal"
  ),
  filtered as (
    select *
    from grouped g
    where
      nullif(trim(coalesce(p_status, '')), '') is null
      or (upper(trim(p_status)) = 'LENGKAP' and g.datang_ts is not null and g.pulang_ts is not null)
      or (upper(trim(p_status)) = 'PUNCH_TUNGGAL' and g.has_single_punch)
      or (
        upper(trim(p_status)) = 'BELUM_LENGKAP'
        and not g.has_single_punch
        and (g.datang_ts is null or g.pulang_ts is null)
      )
  ),
  paged as (
    select f.*, count(*) over() as full_count
    from filtered f
    order by f."Tanggal" desc, f."Nama_Lengkap"
    offset ((greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 20), 1), 100))
    limit least(greatest(coalesce(p_page_size, 20), 1), 100)
  )
  select
    jsonb_build_object(
      'ID_User', p."ID_User",
      'namaLengkap', p."Nama_Lengkap",
      'sppg', p."SPPG",
      'Tanggal', p."Tanggal",
      'jamMasuk', to_char(coalesce(p.datang_ts, p.tunggal_ts) at time zone 'Asia/Jakarta', 'HH24:MI:SS'),
      'jamPulang', to_char(p.pulang_ts at time zone 'Asia/Jakarta', 'HH24:MI:SS'),
      'statusMasuk', case when coalesce(p.datang_ts, p.tunggal_ts) is not null then 'VALID' end,
      'statusPulang', case when p.pulang_ts is not null then 'VALID' end,
      'punches', p.punches,
      'sumber', p.sumber
    ) as row_data,
    p.full_count as total_count
  from paged p;
$$;

revoke all on function public.get_absensi_grouped_page_v2(
  text[], integer, integer, text, date, date, text, text, text
) from public, anon, authenticated;

grant execute on function public.get_absensi_grouped_page_v2(
  text[], integer, integer, text, date, date, text, text, text
) to service_role;

comment on function public.get_absensi_grouped_page_v2(
  text[], integer, integer, text, date, date, text, text, text
) is 'Server-side grouped attendance query with role-scoped UI filters.';
