-- Security-only hardening for legacy/self attendance, OTP verification concurrency,
-- and cross-SPPG device review. Designed to be additive and backward compatible.

-- 1) Defense-in-depth invariant for legacy self attendance.
-- Any attendance row written by a SELF_<user-id> device must belong to the same user.
create or replace function public.enforce_self_attendance_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new."ID_Device", '') like 'SELF\_%' escape '\' then
    if new."ID_User" is null
       or substring(new."ID_Device" from 6) <> new."ID_User" then
      raise exception 'SELF_ATTENDANCE_IDENTITY_MISMATCH' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_self_attendance_identity() from public, anon, authenticated;

drop trigger if exists trg_enforce_self_attendance_identity on public."Absensi";
create trigger trg_enforce_self_attendance_identity
before insert or update of "ID_User", "ID_Device"
on public."Absensi"
for each row execute function public.enforce_self_attendance_identity();

-- 2) Make the existing Email_OTP failure counter monotonic under concurrent updates.
-- The legacy API sends a client-computed old+1 value; this trigger serializes the row
-- and replaces that value with the current database value + 1.
create or replace function public.enforce_email_otp_attempt_counter()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new."Kode_OTP" is not distinct from old."Kode_OTP"
     and new."Tujuan" is not distinct from old."Tujuan"
     and new."Expires_At" is not distinct from old."Expires_At"
     and new."Percobaan_Gagal" is distinct from old."Percobaan_Gagal" then
    if old."Percobaan_Gagal" >= 5 then
      raise exception 'OTP_ATTEMPT_LIMIT_REACHED' using errcode = '22023';
    end if;
    new."Percobaan_Gagal" := old."Percobaan_Gagal" + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_email_otp_attempt_counter() from public, anon, authenticated;

drop trigger if exists trg_enforce_email_otp_attempt_counter on public."Email_OTP";
create trigger trg_enforce_email_otp_attempt_counter
before update of "Percobaan_Gagal"
on public."Email_OTP"
for each row execute function public.enforce_email_otp_attempt_counter();

-- A correct OTP verification does not update Email_OTP before issuing a reset token.
-- Claim one of the same five attempt slots atomically when a reset token is issued.
-- This prevents a correct guess among a large concurrent batch from bypassing the
-- five-attempt limit. Non-OTP token issuance remains compatible when no RESET row exists.
create or replace function public.claim_reset_otp_attempt_before_token()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_has_reset_otp boolean := false;
  v_otp_user text;
begin
  if new."Token_Reset_Password" is distinct from old."Token_Reset_Password"
     and coalesce(new."Token_Reset_Password", '') <> ''
     and coalesce(new."Email", '') <> '' then
    select exists(
      select 1
      from public."Email_OTP"
      where lower("Email") = lower(new."Email")
        and "Tujuan" = 'RESET'
    ) into v_has_reset_otp;

    if v_has_reset_otp then
      update public."Email_OTP"
      set "Percobaan_Gagal" = "Percobaan_Gagal" + 1
      where lower("Email") = lower(new."Email")
        and "Tujuan" = 'RESET'
        and "Expires_At" > clock_timestamp()
        and "Percobaan_Gagal" < 5
      returning "ID_User" into v_otp_user;

      if not found then
        raise exception 'RESET_OTP_ATTEMPT_LIMIT_REACHED' using errcode = '22023';
      end if;
      if v_otp_user is not null and v_otp_user <> new."ID_User" then
        raise exception 'RESET_OTP_USER_MISMATCH' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.claim_reset_otp_attempt_before_token() from public, anon, authenticated;

drop trigger if exists trg_claim_reset_otp_attempt_before_token on public."Users";
create trigger trg_claim_reset_otp_attempt_before_token
before update of "Token_Reset_Password"
on public."Users"
for each row execute function public.claim_reset_otp_attempt_before_token();

-- 3) Scope the SECURITY DEFINER device-review RPC to the actor's SPPG access.
create or replace function public.review_attendance_device(
  p_actor_user_id text,
  p_device_id text,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := upper(trim(coalesce(p_status,'')));
  v_reason text := trim(coalesce(p_reason,''));
  v_role text;
  v_actor_email text;
  v_actor_sppg text;
  v_target_sppg text;
  v_row public."Attendance_Devices"%rowtype;
begin
  select
    upper(replace(coalesce("Role",''),'_',' ')),
    coalesce("Email",''),
    coalesce("SPPG",'')
  into v_role, v_actor_email, v_actor_sppg
  from public."Users"
  where "ID_User" = p_actor_user_id
    and "Status_Aktif" = true;

  if v_role not in ('ADMIN','SUPER ADMIN') then
    raise exception 'FORBIDDEN';
  end if;
  if v_status not in ('TRUSTED','REVOKED','BLOCKED','PENDING') then
    raise exception 'STATUS_INVALID';
  end if;
  if length(v_reason) < 10 then
    raise exception 'REASON_REQUIRED';
  end if;

  select coalesce(u."SPPG",'')
  into v_target_sppg
  from public."Attendance_Devices" d
  join public."Users" u on u."ID_User" = d."ID_User"
  where d."Device_ID" = p_device_id;

  if not found then
    raise exception 'DEVICE_NOT_FOUND';
  end if;

  if v_role <> 'SUPER ADMIN' then
    if v_target_sppg = '' or not (
      v_target_sppg = v_actor_sppg
      or exists (
        select 1
        from public."Akses_Email" ae
        where lower(ae."Email") = lower(v_actor_email)
          and ae."Aktif" = true
          and ae."SPPG" = v_target_sppg
      )
    ) then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  update public."Attendance_Devices"
  set "Status" = v_status,
      "Trust_Reason" = v_reason,
      "Reviewed_At" = now(),
      "Reviewed_By" = p_actor_user_id,
      "Revoked_At" = case when v_status = 'REVOKED' then now() else null end,
      "Updated_At" = now()
  where "Device_ID" = p_device_id
  returning * into v_row;

  if v_row."Device_ID" is null then
    raise exception 'DEVICE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'Device_ID', v_row."Device_ID",
    'Status', v_row."Status",
    'Risk_Score', v_row."Risk_Score",
    'Trust_Reason', v_row."Trust_Reason",
    'Reviewed_At', v_row."Reviewed_At"
  );
end;
$$;

revoke all on function public.review_attendance_device(text,text,text,text) from public, anon, authenticated;
grant execute on function public.review_attendance_device(text,text,text,text) to service_role;
