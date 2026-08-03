-- Sprint 6: production readiness, configurable enforcement, and deployment audit.

create table if not exists public."Attendance_Policies" (
  "Policy_ID" uuid primary key default gen_random_uuid(),
  "SPPG" text not null unique,
  "Require_Trusted_Device" boolean not null default false,
  "Block_Revoked_Device" boolean not null default true,
  "Max_Accuracy_Meter" integer not null default 60 check ("Max_Accuracy_Meter" between 10 and 500),
  "Challenge_TTL_Seconds" integer not null default 60 check ("Challenge_TTL_Seconds" between 15 and 300),
  "Impossible_Travel_Kmh" numeric(10,2) not null default 250 check ("Impossible_Travel_Kmh" between 50 and 1500),
  "Auto_Create_Incident" boolean not null default true,
  "Active" boolean not null default true,
  "Updated_By" text,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now()
);

create table if not exists public."Deployment_Audit" (
  "Audit_ID" bigserial primary key,
  "Release_Name" text not null,
  "Commit_SHA" text,
  "Environment" text not null check ("Environment" in ('DEVELOPMENT','STAGING','PRODUCTION')),
  "Component" text not null,
  "Check_Name" text not null,
  "Status" text not null check ("Status" in ('PASS','WARN','FAIL')),
  "Detail" jsonb not null default '{}'::jsonb,
  "Checked_By" text,
  "Checked_At" timestamptz not null default now()
);

create index if not exists deployment_audit_release_idx
  on public."Deployment_Audit" ("Release_Name", "Environment", "Checked_At" desc);

create or replace function public.get_attendance_policy(p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sppg text;
  v_policy public."Attendance_Policies"%rowtype;
begin
  select "SPPG" into v_sppg from public."Users" where "ID_User" = p_user_id limit 1;
  select * into v_policy
  from public."Attendance_Policies"
  where "SPPG" = v_sppg and "Active" = true
  limit 1;

  return jsonb_build_object(
    'sppg', v_sppg,
    'requireTrustedDevice', coalesce(v_policy."Require_Trusted_Device", false),
    'blockRevokedDevice', coalesce(v_policy."Block_Revoked_Device", true),
    'maxAccuracyMeter', coalesce(v_policy."Max_Accuracy_Meter", 60),
    'challengeTtlSeconds', coalesce(v_policy."Challenge_TTL_Seconds", 60),
    'impossibleTravelKmh', coalesce(v_policy."Impossible_Travel_Kmh", 250),
    'autoCreateIncident', coalesce(v_policy."Auto_Create_Incident", true)
  );
end;
$$;

create or replace function public.evaluate_attendance_readiness(
  p_user_id text,
  p_device_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy jsonb;
  v_device public."Attendance_Devices"%rowtype;
  v_travel jsonb;
  v_reasons text[] := array[]::text[];
  v_allowed boolean := true;
  v_risk integer := 0;
begin
  v_policy := public.get_attendance_policy(p_user_id);

  if p_accuracy is null or p_accuracy > (v_policy->>'maxAccuracyMeter')::numeric then
    v_allowed := false;
    v_risk := v_risk + 40;
    v_reasons := array_append(v_reasons, 'LOCATION_ACCURACY_TOO_LOW');
  end if;

  if p_device_id is null then
    v_risk := v_risk + 20;
    v_reasons := array_append(v_reasons, 'DEVICE_NOT_REGISTERED');
    if (v_policy->>'requireTrustedDevice')::boolean then v_allowed := false; end if;
  else
    select * into v_device from public."Attendance_Devices"
    where "Device_ID" = p_device_id and "ID_User" = p_user_id limit 1;

    if not found then
      v_allowed := false;
      v_risk := v_risk + 40;
      v_reasons := array_append(v_reasons, 'DEVICE_OWNER_MISMATCH');
    elsif v_device."Status" in ('BLOCKED','REVOKED') and (v_policy->>'blockRevokedDevice')::boolean then
      v_allowed := false;
      v_risk := v_risk + 70;
      v_reasons := array_append(v_reasons, 'DEVICE_NOT_ALLOWED');
    elsif v_device."Status" <> 'TRUSTED' then
      v_risk := v_risk + 20;
      v_reasons := array_append(v_reasons, 'DEVICE_PENDING_TRUST');
      if (v_policy->>'requireTrustedDevice')::boolean then v_allowed := false; end if;
    end if;
  end if;

  select public.detect_impossible_travel(
    p_user_id,
    p_latitude,
    p_longitude,
    now(),
    (v_policy->>'impossibleTravelKmh')::numeric
  ) into v_travel;

  if coalesce((v_travel->>'impossibleTravel')::boolean, false) then
    v_risk := v_risk + 60;
    v_reasons := array_append(v_reasons, 'IMPOSSIBLE_TRAVEL');
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'riskScore', least(v_risk, 100),
    'riskLevel', case when v_risk >= 60 then 'HIGH' when v_risk >= 30 then 'MEDIUM' else 'LOW' end,
    'reasons', to_jsonb(v_reasons),
    'policy', v_policy,
    'travel', coalesce(v_travel, '{}'::jsonb)
  );
end;
$$;

create or replace function public.production_readiness_report()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'generatedAt', now(),
    'tables', jsonb_build_object(
      'attendanceChallenges', to_regclass('public."Attendance_Challenges"') is not null,
      'attendanceDevices', to_regclass('public."Attendance_Devices"') is not null,
      'securityIncidents', to_regclass('public."Security_Incidents"') is not null,
      'healthMetrics', to_regclass('public."System_Health_Metrics"') is not null,
      'attendancePolicies', to_regclass('public."Attendance_Policies"') is not null
    ),
    'functions', jsonb_build_object(
      'rateLimit', to_regprocedure('public.consume_api_rate_limit(text,text,integer,integer)') is not null,
      'impossibleTravel', to_regprocedure('public.detect_impossible_travel(text,double precision,double precision,timestamp with time zone,numeric)') is not null,
      'readinessEvaluation', to_regprocedure('public.evaluate_attendance_readiness(text,uuid,double precision,double precision,numeric)') is not null
    ),
    'counts', jsonb_build_object(
      'devices', (select count(*) from public."Attendance_Devices"),
      'pendingDevices', (select count(*) from public."Attendance_Devices" where "Status" = 'PENDING'),
      'openIncidents', (select count(*) from public."Security_Incidents" where "Status" in ('OPEN','INVESTIGATING','CONFIRMED')),
      'activePolicies', (select count(*) from public."Attendance_Policies" where "Active" = true)
    )
  );
$$;
