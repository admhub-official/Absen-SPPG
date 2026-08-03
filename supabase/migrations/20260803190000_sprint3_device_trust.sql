-- Sprint 3: device trust, device review, dan impossible-travel evidence.

create table if not exists public."Attendance_Devices" (
  "Device_ID" uuid primary key default gen_random_uuid(),
  "ID_User" text not null references public."Users"("ID_User") on delete cascade,
  "Device_Key_Hash" text not null,
  "Device_Name" text,
  "Platform" text,
  "Browser" text,
  "User_Agent" text,
  "Status" text not null default 'PENDING' check ("Status" in ('PENDING','TRUSTED','REVOKED','BLOCKED')),
  "Trust_Reason" text,
  "Risk_Score" integer not null default 0 check ("Risk_Score" between 0 and 100),
  "First_Seen_At" timestamptz not null default now(),
  "Last_Seen_At" timestamptz not null default now(),
  "Last_Attendance_At" timestamptz,
  "Last_IP" text,
  "Last_Latitude" double precision,
  "Last_Longitude" double precision,
  "Last_Accuracy_Meter" double precision,
  "Reviewed_At" timestamptz,
  "Reviewed_By" text references public."Users"("ID_User"),
  "Revoked_At" timestamptz,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  unique ("ID_User", "Device_Key_Hash")
);

create index if not exists "Attendance_Devices_User_Status_idx"
  on public."Attendance_Devices" ("ID_User", "Status", "Last_Seen_At" desc);
create index if not exists "Attendance_Devices_Status_idx"
  on public."Attendance_Devices" ("Status", "Risk_Score" desc, "Last_Seen_At" desc);

alter table public."Attendance_Devices" enable row level security;
revoke all on public."Attendance_Devices" from anon, authenticated;

alter table public."Attendance_Challenges"
  add column if not exists "Device_ID" uuid references public."Attendance_Devices"("Device_ID"),
  add column if not exists "Device_Key_Hash" text,
  add column if not exists "Device_Status" text,
  add column if not exists "Travel_Speed_Kmh" numeric,
  add column if not exists "Travel_Distance_Meter" integer;

alter table public."Attendance_Security_Events"
  add column if not exists "Device_ID" uuid references public."Attendance_Devices"("Device_ID");

create or replace function public.calculate_distance_meter(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
) returns double precision
language sql immutable strict
as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
    cos(radians(p_lat1)) * cos(radians(p_lat2)) *
    power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
$$;

create or replace function public.review_attendance_device(
  p_actor_user_id text,
  p_device_id uuid,
  p_status text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_target public."Attendance_Devices"%rowtype;
begin
  select upper(replace(coalesce("Role", ''), '_', ' ')) into v_role
  from public."Users" where "ID_User" = p_actor_user_id;
  if v_role not in ('ADMIN','SUPER ADMIN') then
    raise exception 'FORBIDDEN';
  end if;
  if upper(p_status) not in ('TRUSTED','REVOKED','BLOCKED','PENDING') then
    raise exception 'DEVICE_STATUS_INVALID';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'DEVICE_REVIEW_REASON_REQUIRED';
  end if;

  update public."Attendance_Devices"
  set "Status" = upper(p_status),
      "Trust_Reason" = trim(p_reason),
      "Reviewed_At" = now(),
      "Reviewed_By" = p_actor_user_id,
      "Revoked_At" = case when upper(p_status) in ('REVOKED','BLOCKED') then now() else null end,
      "Updated_At" = now()
  where "Device_ID" = p_device_id
  returning * into v_target;

  if v_target."Device_ID" is null then raise exception 'DEVICE_NOT_FOUND'; end if;
  return jsonb_build_object('deviceId', v_target."Device_ID", 'status', v_target."Status");
end;
$$;

revoke all on function public.review_attendance_device(text, uuid, text, text) from public, anon, authenticated;

comment on table public."Attendance_Devices" is
  'Registry pseudonim perangkat untuk device trust; tidak menyimpan serial perangkat atau identifier hardware mentah.';
