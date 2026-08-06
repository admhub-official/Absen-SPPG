-- Backend source of truth for location-based self attendance.

alter table public."Lokasi_SPPG"
  drop constraint if exists "Lokasi_SPPG_Radius_Meter_check";

alter table public."Lokasi_SPPG"
  add constraint "Lokasi_SPPG_Radius_Meter_check"
  check ("Radius_Meter" between 1 and 100);

create or replace function public.acquire_absen_lock_v1(
  p_user_id text,
  p_ttl_seconds integer default 20
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
  v_ttl integer := greatest(5, least(coalesce(p_ttl_seconds, 20), 120));
begin
  if nullif(btrim(p_user_id), '') is null then
    raise exception 'ID pengguna wajib diisi.';
  end if;

  insert into public."Absen_Locks"("ID_User", "Locked_At", "Expires_At")
  values (p_user_id, clock_timestamp(), clock_timestamp() + make_interval(secs => v_ttl))
  on conflict ("ID_User") do update
  set "Locked_At" = excluded."Locked_At",
      "Expires_At" = excluded."Expires_At"
  where public."Absen_Locks"."Expires_At" <= clock_timestamp();

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.acquire_absen_lock_v1(text, integer) from public;
grant execute on function public.acquire_absen_lock_v1(text, integer) to service_role;
