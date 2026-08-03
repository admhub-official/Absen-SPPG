-- Sprint 4: security operations, incident workflow, health metrics, and anomaly evidence.

create table if not exists public."Security_Incidents" (
  "Incident_ID" uuid primary key default gen_random_uuid(),
  "Title" text not null,
  "Description" text,
  "Severity" text not null default 'MEDIUM' check ("Severity" in ('LOW','MEDIUM','HIGH','CRITICAL')),
  "Status" text not null default 'OPEN' check ("Status" in ('OPEN','INVESTIGATING','CONFIRMED','RESOLVED','FALSE_POSITIVE')),
  "Source_Event_ID" bigint,
  "ID_User" text,
  "Device_ID" uuid,
  "SPPG" text,
  "Risk_Score" integer not null default 0 check ("Risk_Score" between 0 and 100),
  "Assigned_To" text,
  "Resolution_Notes" text,
  "Created_By" text,
  "Created_At" timestamptz not null default now(),
  "Updated_By" text,
  "Updated_At" timestamptz not null default now(),
  "Resolved_At" timestamptz
);

create index if not exists "Security_Incidents_Status_idx" on public."Security_Incidents" ("Status", "Severity", "Created_At" desc);
create index if not exists "Security_Incidents_User_idx" on public."Security_Incidents" ("ID_User", "Created_At" desc);

create table if not exists public."Security_Incident_Notes" (
  "Note_ID" bigint generated always as identity primary key,
  "Incident_ID" uuid not null references public."Security_Incidents"("Incident_ID") on delete cascade,
  "Author_ID" text not null,
  "Note" text not null check (char_length(trim("Note")) >= 3),
  "Created_At" timestamptz not null default now()
);

create table if not exists public."System_Health_Metrics" (
  "Metric_ID" bigint generated always as identity primary key,
  "Service_Name" text not null,
  "Metric_Name" text not null,
  "Metric_Value" numeric not null,
  "Unit" text,
  "Status" text not null default 'OK' check ("Status" in ('OK','WARN','CRITICAL')),
  "Request_ID" text,
  "Metadata" jsonb not null default '{}'::jsonb,
  "Recorded_At" timestamptz not null default now()
);

create index if not exists "System_Health_Metrics_Service_Time_idx" on public."System_Health_Metrics" ("Service_Name", "Recorded_At" desc);

alter table public."Security_Incidents" enable row level security;
alter table public."Security_Incident_Notes" enable row level security;
alter table public."System_Health_Metrics" enable row level security;
revoke all on public."Security_Incidents", public."Security_Incident_Notes", public."System_Health_Metrics" from anon, authenticated;

create or replace function public.security_dashboard_summary(p_since timestamptz default now() - interval '24 hours')
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'since', p_since,
    'securityEvents', (select count(*) from public."Attendance_Security_Events" where "Created_At" >= p_since),
    'highRiskEvents', (select count(*) from public."Attendance_Security_Events" where "Created_At" >= p_since and "Risk_Level" = 'HIGH'),
    'rejectedEvents', (select count(*) from public."Attendance_Security_Events" where "Created_At" >= p_since and "Result" in ('REJECTED','FAILED')),
    'openIncidents', (select count(*) from public."Security_Incidents" where "Status" in ('OPEN','INVESTIGATING','CONFIRMED')),
    'criticalIncidents', (select count(*) from public."Security_Incidents" where "Status" in ('OPEN','INVESTIGATING','CONFIRMED') and "Severity" = 'CRITICAL'),
    'pendingDevices', (select count(*) from public."Attendance_Devices" where "Status" = 'PENDING'),
    'blockedDevices', (select count(*) from public."Attendance_Devices" where "Status" in ('BLOCKED','REVOKED')),
    'challengeFailures', (select count(*) from public."Attendance_Security_Events" where "Created_At" >= p_since and "Event_Type" like 'CHALLENGE%' and "Result" <> 'SUCCESS')
  );
$$;

create or replace function public.create_incident_from_security_event(
  p_event_id bigint,
  p_actor text,
  p_title text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  e public."Attendance_Security_Events"%rowtype;
  v_id uuid;
begin
  select * into e from public."Attendance_Security_Events" where "Event_ID" = p_event_id;
  if not found then raise exception 'SECURITY_EVENT_NOT_FOUND'; end if;
  insert into public."Security_Incidents" (
    "Title","Description","Severity","Source_Event_ID","ID_User","Device_ID","Risk_Score","Created_By"
  ) values (
    coalesce(nullif(trim(p_title), ''), 'Investigasi ' || coalesce(e."Event_Type", 'security event')),
    'Insiden dibuat dari security event ' || p_event_id,
    case when e."Risk_Score" >= 80 then 'CRITICAL' when e."Risk_Score" >= 60 then 'HIGH' when e."Risk_Score" >= 30 then 'MEDIUM' else 'LOW' end,
    p_event_id,e."ID_User",e."Device_ID",coalesce(e."Risk_Score",0),p_actor
  ) returning "Incident_ID" into v_id;
  return v_id;
end;
$$;

create or replace function public.detect_impossible_travel(
  p_user_id text,
  p_lat double precision,
  p_lng double precision,
  p_at timestamptz default now(),
  p_threshold_kmh numeric default 250
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prev record;
  distance_m numeric;
  elapsed_h numeric;
  speed_kmh numeric;
begin
  select "Last_Attendance_Latitude" lat, "Last_Attendance_Longitude" lng, "Last_Attendance_At" at
  into prev
  from public."Attendance_Devices"
  where "ID_User" = p_user_id and "Last_Attendance_At" is not null
  order by "Last_Attendance_At" desc limit 1;
  if prev.at is null then return jsonb_build_object('detected', false, 'reason', 'NO_PREVIOUS_LOCATION'); end if;
  distance_m := public.haversine_distance_meter(prev.lat, prev.lng, p_lat, p_lng);
  elapsed_h := extract(epoch from (p_at - prev.at)) / 3600.0;
  if elapsed_h <= 0 then return jsonb_build_object('detected', false, 'reason', 'NON_POSITIVE_TIME'); end if;
  speed_kmh := (distance_m / 1000.0) / elapsed_h;
  return jsonb_build_object(
    'detected', speed_kmh > p_threshold_kmh,
    'distanceMeter', round(distance_m),
    'elapsedHours', elapsed_h,
    'speedKmh', speed_kmh,
    'thresholdKmh', p_threshold_kmh,
    'previousAt', prev.at
  );
end;
$$;

comment on table public."Security_Incidents" is 'Workflow investigasi untuk event keamanan dan fraud.';
comment on table public."System_Health_Metrics" is 'Metrik kesehatan dan performa layanan untuk observability.';