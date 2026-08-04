-- Consolidated release Sprint 11-15: enforcement, payroll workflow, complaint privacy, user access.

create table if not exists public."Release_Feature_Flags" (
  "Flag_Key" text primary key,
  "Enabled" boolean not null default false,
  "Scope_SPPG" text null,
  "Config" jsonb not null default '{}'::jsonb,
  "Updated_By" text null,
  "Updated_At" timestamptz not null default now()
);

insert into public."Release_Feature_Flags" ("Flag_Key", "Enabled", "Config") values
  ('ATTENDANCE_DEVICE_ENFORCEMENT', false, '{"mode":"pilot"}'::jsonb),
  ('PAYROLL_WORKFLOW_V2', false, '{"mode":"shadow"}'::jsonb),
  ('COMPLAINT_PRIVACY_V2', true, '{}'::jsonb),
  ('USER_ACCESS_V2', false, '{"mode":"shadow"}'::jsonb)
on conflict ("Flag_Key") do nothing;

create table if not exists public."Payroll_Workflow_State" (
  "Workflow_ID" uuid primary key default gen_random_uuid(),
  "Slip_ID" text not null unique,
  "ID_User" text not null,
  "Status" text not null default 'DRAFT' check ("Status" in ('DRAFT','READY_FOR_ISSUE','WAITING_ACCOUNTANT','WAITING_HEAD','WAITING_RECIPIENT','FINALIZED','VOIDED','FAILED')),
  "Idempotency_Key" text null unique,
  "Last_Error" text null,
  "Version" integer not null default 1,
  "Created_By" text null,
  "Updated_By" text null,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now()
);

create table if not exists public."Payroll_Workflow_Events" (
  "Event_ID" uuid primary key default gen_random_uuid(),
  "Workflow_ID" uuid not null references public."Payroll_Workflow_State"("Workflow_ID") on delete cascade,
  "From_Status" text null,
  "To_Status" text not null,
  "Actor_ID" text null,
  "Reason" text null,
  "Metadata" jsonb not null default '{}'::jsonb,
  "Created_At" timestamptz not null default now()
);

create or replace function public.transition_payroll_workflow(
  p_slip_id text, p_user_id text, p_to_status text, p_actor_id text,
  p_reason text default null, p_idempotency_key text default null
) returns jsonb language plpgsql security definer as $$
declare v_row public."Payroll_Workflow_State"; v_from text;
begin
  if p_to_status not in ('DRAFT','READY_FOR_ISSUE','WAITING_ACCOUNTANT','WAITING_HEAD','WAITING_RECIPIENT','FINALIZED','VOIDED','FAILED') then
    raise exception 'PAYROLL_STATUS_INVALID';
  end if;
  insert into public."Payroll_Workflow_State" ("Slip_ID","ID_User","Status","Idempotency_Key","Created_By","Updated_By")
  values (p_slip_id,p_user_id,'DRAFT',p_idempotency_key,p_actor_id,p_actor_id)
  on conflict ("Slip_ID") do nothing;
  select * into v_row from public."Payroll_Workflow_State" where "Slip_ID"=p_slip_id for update;
  if p_idempotency_key is not null and v_row."Idempotency_Key" is not null and v_row."Idempotency_Key"<>p_idempotency_key then
    raise exception 'PAYROLL_IDEMPOTENCY_CONFLICT';
  end if;
  v_from:=v_row."Status";
  if v_from in ('FINALIZED','VOIDED') and v_from<>p_to_status then raise exception 'PAYROLL_FINAL_STATE'; end if;
  update public."Payroll_Workflow_State" set "Status"=p_to_status,"Updated_By"=p_actor_id,"Updated_At"=now(),"Version"="Version"+1 where "Workflow_ID"=v_row."Workflow_ID";
  insert into public."Payroll_Workflow_Events" ("Workflow_ID","From_Status","To_Status","Actor_ID","Reason") values (v_row."Workflow_ID",v_from,p_to_status,p_actor_id,p_reason);
  return jsonb_build_object('workflowId',v_row."Workflow_ID",'fromStatus',v_from,'toStatus',p_to_status);
end $$;

create table if not exists public."Complaint_Privacy_Access_Log" (
  "Access_ID" uuid primary key default gen_random_uuid(),
  "Complaint_ID" text not null,
  "Actor_ID" text not null,
  "Actor_Role" text not null,
  "Action" text not null check ("Action" in ('VIEW_LIST','VIEW_DETAIL','REVEAL_IDENTITY','EXPORT','DOWNLOAD_ATTACHMENT')),
  "Reason" text null,
  "Request_ID" text null,
  "Created_At" timestamptz not null default now()
);

create table if not exists public."Complaint_Attachments_V2" (
  "Attachment_ID" uuid primary key default gen_random_uuid(),
  "Complaint_ID" text not null,
  "Storage_Path" text not null,
  "Original_Name" text not null,
  "Mime_Type" text not null,
  "Size_Bytes" bigint not null check ("Size_Bytes">=0 and "Size_Bytes"<=10485760),
  "Uploaded_By" text not null,
  "Created_At" timestamptz not null default now()
);

create or replace function public.log_complaint_identity_access(p_complaint_id text,p_actor_id text,p_actor_role text,p_reason text,p_request_id text default null)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if upper(replace(coalesce(p_actor_role,''),'_',' '))<>'SUPER ADMIN' then raise exception 'COMPLAINT_IDENTITY_FORBIDDEN'; end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'COMPLAINT_ACCESS_REASON_REQUIRED'; end if;
  insert into public."Complaint_Privacy_Access_Log" ("Complaint_ID","Actor_ID","Actor_Role","Action","Reason","Request_ID") values (p_complaint_id,p_actor_id,p_actor_role,'REVEAL_IDENTITY',p_reason,p_request_id) returning "Access_ID" into v_id;
  return v_id;
end $$;

create table if not exists public."User_SPPG_Access_V2" (
  "Access_ID" uuid primary key default gen_random_uuid(),
  "ID_User" text not null,
  "SPPG" text not null,
  "Role_Scope" text null,
  "Active" boolean not null default true,
  "Valid_From" timestamptz not null default now(),
  "Valid_Until" timestamptz null,
  "Granted_By" text null,
  "Created_At" timestamptz not null default now(),
  unique ("ID_User","SPPG","Role_Scope")
);

create table if not exists public."User_Security_Events" (
  "Event_ID" uuid primary key default gen_random_uuid(),
  "ID_User" text not null,
  "Event_Type" text not null,
  "Actor_ID" text null,
  "Session_ID" text null,
  "Device_ID" text null,
  "Before_Data" jsonb not null default '{}'::jsonb,
  "After_Data" jsonb not null default '{}'::jsonb,
  "Reason" text null,
  "Created_At" timestamptz not null default now()
);

create or replace function public.enforce_attendance_device_policy() returns trigger language plpgsql security definer as $$
declare v_enabled boolean:=false; v_status text; v_owner text;
begin
  if new."ID_Device" is null then return new; end if;
  select coalesce("Enabled",false) into v_enabled from public."Release_Feature_Flags" where "Flag_Key"='ATTENDANCE_DEVICE_ENFORCEMENT';
  if not coalesce(v_enabled,false) then return new; end if;
  select "Status","ID_User" into v_status,v_owner from public."Attendance_Devices" where "Device_ID"::text=new."ID_Device"::text limit 1;
  if v_status is null then raise exception 'ATTENDANCE_DEVICE_NOT_REGISTERED'; end if;
  if v_owner::text<>new."ID_User"::text then raise exception 'ATTENDANCE_DEVICE_OWNER_MISMATCH'; end if;
  if v_status in ('BLOCKED','REVOKED') then raise exception 'ATTENDANCE_DEVICE_NOT_ALLOWED'; end if;
  return new;
end $$;

drop trigger if exists trg_enforce_attendance_device_policy on public."Absensi";
create trigger trg_enforce_attendance_device_policy before insert or update of "ID_Device" on public."Absensi" for each row execute function public.enforce_attendance_device_policy();

create index if not exists idx_payroll_workflow_status on public."Payroll_Workflow_State"("Status","Updated_At");
create index if not exists idx_complaint_privacy_log on public."Complaint_Privacy_Access_Log"("Complaint_ID","Created_At");
create index if not exists idx_user_access_v2 on public."User_SPPG_Access_V2"("ID_User","Active");
