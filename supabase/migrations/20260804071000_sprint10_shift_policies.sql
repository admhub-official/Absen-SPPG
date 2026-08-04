create table if not exists public."Work_Shift_Policies" (
  "Shift_ID" uuid primary key default gen_random_uuid(),
  "SPPG" text not null,
  "Shift_Name" text not null,
  "Start_Time" time not null,
  "End_Time" time not null,
  "Crosses_Midnight" boolean not null default false,
  "Late_Tolerance_Minutes" integer not null default 0 check ("Late_Tolerance_Minutes" between 0 and 240),
  "Active" boolean not null default true,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  unique ("SPPG","Shift_Name")
);

create or replace function public.resolve_attendance_work_date(p_timestamp timestamptz, p_shift_id uuid)
returns date language sql stable security definer set search_path=public as $$
  select case when s."Crosses_Midnight" and p_timestamp::time < s."End_Time"
    then (p_timestamp::date - 1) else p_timestamp::date end
  from public."Work_Shift_Policies" s where s."Shift_ID"=p_shift_id and s."Active"=true
$$;
revoke all on function public.resolve_attendance_work_date(timestamptz,uuid) from public;
grant execute on function public.resolve_attendance_work_date(timestamptz,uuid) to service_role;
