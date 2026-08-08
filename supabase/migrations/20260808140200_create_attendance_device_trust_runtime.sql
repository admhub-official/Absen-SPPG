create table if not exists public."Attendance_Devices" (
  "Device_ID" text primary key default gen_random_uuid()::text,
  "ID_User" text not null references public."Users"("ID_User") on delete cascade,
  "Device_Key_Hash" text not null,
  "Device_Name" text not null default 'Perangkat tanpa nama',
  "Platform" text,
  "Browser" text,
  "User_Agent" text,
  "Last_IP" text,
  "Risk_Score" integer not null default 20 check ("Risk_Score" between 0 and 100),
  "Status" text not null default 'PENDING' check ("Status" in ('PENDING','TRUSTED','REVOKED','BLOCKED')),
  "Trust_Reason" text,
  "First_Seen_At" timestamptz not null default now(),
  "Last_Seen_At" timestamptz not null default now(),
  "Last_Attendance_At" timestamptz,
  "Reviewed_At" timestamptz,
  "Reviewed_By" text references public."Users"("ID_User") on delete set null,
  "Revoked_At" timestamptz,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  unique ("ID_User", "Device_Key_Hash")
);

create index if not exists attendance_devices_user_status_idx on public."Attendance_Devices" ("ID_User", "Status");
create index if not exists attendance_devices_status_risk_idx on public."Attendance_Devices" ("Status", "Risk_Score" desc, "Last_Seen_At" desc);

alter table public."Attendance_Devices" enable row level security;
revoke all on public."Attendance_Devices" from anon, authenticated;
grant all on public."Attendance_Devices" to service_role;

create or replace function public.review_attendance_device(
  p_actor_user_id text,
  p_device_id text,
  p_status text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := upper(trim(coalesce(p_status,'')));
  v_reason text := trim(coalesce(p_reason,''));
  v_role text;
  v_row public."Attendance_Devices"%rowtype;
begin
  select upper(replace(coalesce("Role",''),'_',' ')) into v_role
  from public."Users" where "ID_User" = p_actor_user_id and "Status_Aktif" = true;
  if v_role not in ('ADMIN','SUPER ADMIN') then raise exception 'FORBIDDEN'; end if;
  if v_status not in ('TRUSTED','REVOKED','BLOCKED','PENDING') then raise exception 'STATUS_INVALID'; end if;
  if length(v_reason) < 10 then raise exception 'REASON_REQUIRED'; end if;

  update public."Attendance_Devices"
  set "Status" = v_status,
      "Trust_Reason" = v_reason,
      "Reviewed_At" = now(),
      "Reviewed_By" = p_actor_user_id,
      "Revoked_At" = case when v_status = 'REVOKED' then now() else null end,
      "Updated_At" = now()
  where "Device_ID" = p_device_id
  returning * into v_row;

  if v_row."Device_ID" is null then raise exception 'DEVICE_NOT_FOUND'; end if;
  return jsonb_build_object('Device_ID',v_row."Device_ID",'Status',v_row."Status",'Risk_Score',v_row."Risk_Score",'Trust_Reason',v_row."Trust_Reason",'Reviewed_At',v_row."Reviewed_At");
end;
$$;

revoke all on function public.review_attendance_device(text,text,text,text) from public, anon, authenticated;
grant execute on function public.review_attendance_device(text,text,text,text) to service_role;
