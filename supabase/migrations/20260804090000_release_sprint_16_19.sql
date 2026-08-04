-- Sprint 16-19 consolidated foundation
create table if not exists public."User_Profile_Change_Log" (
  "Change_ID" uuid primary key default gen_random_uuid(),
  "ID_User" text not null,
  "Actor_ID" text not null,
  "Change_Type" text not null check ("Change_Type" in ('PROFILE','PASSWORD','FACE','ROLE','SPPG_ACCESS','SESSION_REVOKE')),
  "Before_Data" jsonb not null default '{}'::jsonb,
  "After_Data" jsonb not null default '{}'::jsonb,
  "Reason" text,
  "Request_ID" text,
  "Created_At" timestamptz not null default now()
);

create table if not exists public."Work_Shift_Assignments" (
  "Assignment_ID" uuid primary key default gen_random_uuid(),
  "ID_User" text not null,
  "Shift_ID" uuid references public."Work_Shift_Policies"("Shift_ID") on delete restrict,
  "SPPG" text,
  "Valid_From" date not null,
  "Valid_Until" date,
  "Assigned_By" text not null,
  "Notes" text,
  "Is_Active" boolean not null default true,
  "Created_At" timestamptz not null default now(),
  check ("Valid_Until" is null or "Valid_Until" >= "Valid_From")
);
create index if not exists work_shift_assignments_user_date_idx on public."Work_Shift_Assignments"("ID_User","Valid_From","Valid_Until");

create table if not exists public."Work_Calendar_Days" (
  "Calendar_ID" uuid primary key default gen_random_uuid(),
  "SPPG" text,
  "Work_Date" date not null,
  "Day_Type" text not null check ("Day_Type" in ('WORKDAY','HOLIDAY','LEAVE','SPECIAL')),
  "Name" text not null,
  "Created_By" text not null,
  "Created_At" timestamptz not null default now(),
  unique("SPPG","Work_Date")
);

create table if not exists public."Notifications" (
  "Notification_ID" uuid primary key default gen_random_uuid(),
  "ID_User" text,
  "Target_Role" text,
  "Type" text not null,
  "Title" text not null,
  "Message" text not null,
  "Priority" text not null default 'NORMAL' check ("Priority" in ('LOW','NORMAL','HIGH','CRITICAL')),
  "Action_URL" text,
  "Payload" jsonb not null default '{}'::jsonb,
  "Read_At" timestamptz,
  "Delivered_At" timestamptz,
  "Expires_At" timestamptz,
  "Created_By" text,
  "Created_At" timestamptz not null default now(),
  check ("ID_User" is not null or "Target_Role" is not null)
);
create index if not exists notifications_user_created_idx on public."Notifications"("ID_User","Created_At" desc);
create index if not exists notifications_role_created_idx on public."Notifications"("Target_Role","Created_At" desc);

create table if not exists public."Notification_Preferences" (
  "ID_User" text primary key,
  "In_App_Enabled" boolean not null default true,
  "Push_Enabled" boolean not null default true,
  "Sound_Enabled" boolean not null default false,
  "Quiet_Hours_Start" time,
  "Quiet_Hours_End" time,
  "Updated_At" timestamptz not null default now()
);

create table if not exists public."Report_Schedules" (
  "Schedule_ID" uuid primary key default gen_random_uuid(),
  "Name" text not null,
  "Report_Type" text not null check ("Report_Type" in ('ATTENDANCE','PAYROLL','COMPLAINTS','SECURITY','USERS')),
  "SPPG" text,
  "Frequency" text not null check ("Frequency" in ('DAILY','WEEKLY','MONTHLY')),
  "Format" text not null default 'CSV' check ("Format" in ('CSV','PDF','XLSX')),
  "Recipients" jsonb not null default '[]'::jsonb,
  "Filters" jsonb not null default '{}'::jsonb,
  "Next_Run_At" timestamptz,
  "Last_Run_At" timestamptz,
  "Is_Active" boolean not null default true,
  "Created_By" text not null,
  "Created_At" timestamptz not null default now()
);

create or replace function public.resolve_user_shift(p_user_id text, p_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a record; s record;
begin
  select * into a from public."Work_Shift_Assignments"
  where "ID_User"=p_user_id and "Is_Active"=true and "Valid_From"<=p_at::date
    and ("Valid_Until" is null or "Valid_Until">=p_at::date)
  order by "Valid_From" desc limit 1;
  if a is null then return jsonb_build_object('assigned',false); end if;
  select * into s from public."Work_Shift_Policies" where "Shift_ID"=a."Shift_ID";
  return jsonb_build_object('assigned',true,'assignmentId',a."Assignment_ID",'shiftId',a."Shift_ID",'name',s."Name",'start',s."Start_Time",'end',s."End_Time",'crossesMidnight',s."Crosses_Midnight",'sppg',a."SPPG");
end $$;

create or replace function public.mark_notification_read(p_notification_id uuid, p_user_id text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  update public."Notifications" set "Read_At"=coalesce("Read_At",now())
  where "Notification_ID"=p_notification_id and "ID_User"=p_user_id;
  return found;
end $$;

create or replace function public.attendance_analytics_summary(p_from date, p_to date, p_sppg text default null) returns jsonb
language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'from',p_from,'to',p_to,
    'total',count(*),
    'users',count(distinct "ID_User"),
    'valid',count(*) filter (where coalesce("Status_Validasi",'VALID')='VALID'),
    'datang',count(*) filter (where "Jenis_Absen"='DATANG'),
    'pulang',count(*) filter (where "Jenis_Absen"='PULANG')
  ) from public."Absensi"
  where "Tanggal" between p_from and p_to
    and (p_sppg is null or coalesce("Nama_SPPG",'')=p_sppg);
$$;

alter table public."User_Profile_Change_Log" enable row level security;
alter table public."Work_Shift_Assignments" enable row level security;
alter table public."Work_Calendar_Days" enable row level security;
alter table public."Notifications" enable row level security;
alter table public."Notification_Preferences" enable row level security;
alter table public."Report_Schedules" enable row level security;
