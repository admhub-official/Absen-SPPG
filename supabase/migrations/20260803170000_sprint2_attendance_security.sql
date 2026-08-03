-- Sprint 2: challenge presensi sekali pakai, rate limiting, audit context, dan risk indicator.

create table if not exists public."Attendance_Challenges" (
  "Challenge_ID" uuid primary key,
  "ID_User" text not null,
  "Session_Token_Hash" text not null,
  "Latitude" double precision not null,
  "Longitude" double precision not null,
  "Accuracy_Meter" double precision not null,
  "Location_Captured_At" timestamptz not null,
  "Risk_Score" integer not null default 0 check ("Risk_Score" between 0 and 100),
  "Risk_Level" text not null default 'LOW' check ("Risk_Level" in ('LOW','MEDIUM','HIGH')),
  "Issued_IP" text,
  "Issued_User_Agent" text,
  "Created_At" timestamptz not null default now(),
  "Expires_At" timestamptz not null,
  "Used_At" timestamptz,
  "Used_Request_ID" text
);

create index if not exists "Attendance_Challenges_User_Expires_idx"
  on public."Attendance_Challenges" ("ID_User", "Expires_At" desc);
create index if not exists "Attendance_Challenges_Expiry_idx"
  on public."Attendance_Challenges" ("Expires_At") where "Used_At" is null;

alter table public."Attendance_Challenges" enable row level security;
revoke all on public."Attendance_Challenges" from anon, authenticated;

create table if not exists public."API_Rate_Limits" (
  "Rate_Key" text not null,
  "Action" text not null,
  "Window_Start" timestamptz not null,
  "Request_Count" integer not null default 1,
  "Updated_At" timestamptz not null default now(),
  primary key ("Rate_Key", "Action")
);

create index if not exists "API_Rate_Limits_Updated_idx"
  on public."API_Rate_Limits" ("Updated_At");

alter table public."API_Rate_Limits" enable row level security;
revoke all on public."API_Rate_Limits" from anon, authenticated;

create table if not exists public."Attendance_Security_Events" (
  "Event_ID" uuid primary key default gen_random_uuid(),
  "Request_ID" text not null,
  "ID_User" text,
  "Challenge_ID" uuid,
  "Event_Type" text not null,
  "Result" text not null check ("Result" in ('SUCCESS','REJECTED','FAILED')),
  "Risk_Score" integer not null default 0 check ("Risk_Score" between 0 and 100),
  "Risk_Level" text not null default 'LOW' check ("Risk_Level" in ('LOW','MEDIUM','HIGH')),
  "Client_IP" text,
  "User_Agent" text,
  "Origin" text,
  "Latitude" double precision,
  "Longitude" double precision,
  "Accuracy_Meter" double precision,
  "Detail" jsonb not null default '{}'::jsonb,
  "Created_At" timestamptz not null default now()
);

create index if not exists "Attendance_Security_Events_User_Created_idx"
  on public."Attendance_Security_Events" ("ID_User", "Created_At" desc);
create index if not exists "Attendance_Security_Events_Risk_idx"
  on public."Attendance_Security_Events" ("Risk_Level", "Created_At" desc);

alter table public."Attendance_Security_Events" enable row level security;
revoke all on public."Attendance_Security_Events" from anon, authenticated;

create or replace function public.consume_api_rate_limit(
  p_rate_key text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public."API_Rate_Limits"%rowtype;
begin
  if coalesce(p_rate_key, '') = '' or coalesce(p_action, '') = '' then
    raise exception 'RATE_LIMIT_KEY_INVALID';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'RATE_LIMIT_CONFIG_INVALID';
  end if;

  insert into public."API_Rate_Limits" (
    "Rate_Key", "Action", "Window_Start", "Request_Count", "Updated_At"
  ) values (
    p_rate_key, p_action, v_now, 1, v_now
  )
  on conflict ("Rate_Key", "Action") do update
  set
    "Window_Start" = case
      when public."API_Rate_Limits"."Window_Start" + make_interval(secs => p_window_seconds) <= v_now
        then v_now
      else public."API_Rate_Limits"."Window_Start"
    end,
    "Request_Count" = case
      when public."API_Rate_Limits"."Window_Start" + make_interval(secs => p_window_seconds) <= v_now
        then 1
      else public."API_Rate_Limits"."Request_Count" + 1
    end,
    "Updated_At" = v_now
  returning * into v_row;

  return jsonb_build_object(
    'allowed', v_row."Request_Count" <= p_limit,
    'count', v_row."Request_Count",
    'limit', p_limit,
    'retryAfterSeconds', greatest(
      0,
      ceil(extract(epoch from (
        v_row."Window_Start" + make_interval(secs => p_window_seconds) - v_now
      )))::integer
    )
  );
end;
$$;

revoke all on function public.consume_api_rate_limit(text,text,integer,integer) from public, anon, authenticated;

comment on table public."Attendance_Challenges" is
  'Challenge lokasi presensi mandiri yang terikat sesi, kedaluwarsa, dan sekali pakai.';
comment on table public."Attendance_Security_Events" is
  'Audit keamanan presensi yang menyimpan request context dan risk indicator tanpa data biometrik.';
