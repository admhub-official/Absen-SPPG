create or replace function public.get_operational_dashboard_counts(p_sppg text[] default null)
returns jsonb
language sql
stable
set search_path = ''
as $function$
select jsonb_build_object(
  'openTickets', (
    select count(*)
    from public."Pengaduan" p
    where (p_sppg is null or p."SPPG" = any(p_sppg))
      and upper(replace(coalesce(p."Status_Tiket", ''), '_', ' ')) not in ('SELESAI','DITUTUP','CLOSED','CLOSE')
  ),
  'pendingRecipientSignatures', (
    select count(*)
    from public."Slip_Gaji" s
    where (p_sppg is null or s."SPPG" = any(p_sppg))
      and s."Status_Penerbitan" = 'MENUNGGU_TTD_PENERIMA'
  )
);
$function$;
