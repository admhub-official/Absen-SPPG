create extension if not exists pgcrypto;

create table if not exists public."Attendance_Import_Jobs" (
  "ID_Import" uuid primary key default gen_random_uuid(),
  "File_Name" text not null,
  "File_Hash" text,
  "SPPG" text not null,
  "Yayasan" text,
  "Period_Start" date,
  "Period_End" date,
  "Uploaded_By" text not null references public."Users"("ID_User"),
  "Status" text not null default 'UPLOADED',
  "Total_Source_Employees" integer not null default 0,
  "Total_Target_Accounts" integer not null default 0,
  "Total_Scans_Read" integer not null default 0,
  "Total_Scans_Inserted" integer not null default 0,
  "Total_Scans_Skipped" integer not null default 0,
  "Total_Errors" integer not null default 0,
  "Import_Settings_JSON" jsonb not null default '{}'::jsonb,
  "Created_At" timestamptz not null default now(),
  "Completed_At" timestamptz,
  constraint attendance_import_status_check check ("Status" in ('UPLOADED','PARSING','NEEDS_REVIEW','READY','PROCESSING','COMPLETED','PARTIAL','FAILED','ROLLED_BACK'))
);

create table if not exists public."Attendance_Name_Mappings" (
  "ID_Mapping" uuid primary key default gen_random_uuid(),
  "SPPG" text not null,
  "Source_Name_Normalized" text not null,
  "Source_Machine_ID" text,
  "Source_Department" text,
  "Mapping_Mode" text not null default 'SINGLE',
  "Target_User_IDs" text[] not null default '{}',
  "Date_Rules_JSON" jsonb not null default '{}'::jsonb,
  "Is_Active" boolean not null default true,
  "Created_By" text not null references public."Users"("ID_User"),
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  constraint attendance_mapping_mode_check check ("Mapping_Mode" in ('SINGLE','COPY_TO_MULTIPLE','SPLIT_BY_DATE','IGNORE')),
  unique ("SPPG", "Source_Name_Normalized", "Source_Machine_ID")
);

create table if not exists public."Attendance_Import_Rows" (
  "ID_Import_Row" uuid primary key default gen_random_uuid(),
  "ID_Import" uuid not null references public."Attendance_Import_Jobs"("ID_Import") on delete cascade,
  "Machine_Employee_ID" text,
  "Source_Name" text not null,
  "Source_Department" text,
  "Attendance_Date" date not null,
  "Parsed_Scans_JSON" jsonb not null default '[]'::jsonb,
  "Target_User_IDs" text[] not null default '{}',
  "Validation_Status" text not null default 'PENDING',
  "Validation_Message" text,
  "Created_At" timestamptz not null default now()
);

create table if not exists public."Attendance_Import_Role_Config" (
  "Role" text primary key,
  "Menu_Enabled" boolean not null default false,
  "Can_Upload" boolean not null default false,
  "Can_Save_Mapping" boolean not null default false,
  "Can_Force_Duplicate" boolean not null default false,
  "Updated_By" text references public."Users"("ID_User"),
  "Updated_At" timestamptz not null default now()
);

insert into public."Attendance_Import_Role_Config" ("Role","Menu_Enabled","Can_Upload","Can_Save_Mapping","Can_Force_Duplicate") values
('SUPER ADMIN',true,true,true,true),
('ADMIN',true,true,true,false),
('AKUNTAN',true,true,false,false),
('USER',false,false,false,false)
on conflict ("Role") do nothing;

alter table public."Absensi" add column if not exists "ID_Import" uuid references public."Attendance_Import_Jobs"("ID_Import");
alter table public."Absensi" add column if not exists "ID_Import_Row" uuid references public."Attendance_Import_Rows"("ID_Import_Row");
alter table public."Absensi" add column if not exists "Mapping_Mode" text;

create unique index if not exists attendance_import_dedupe_idx on public."Absensi" ("ID_User","Tanggal","Waktu_Timestamp","Sumber_Data") where "Sumber_Data" = 'IMPORT_FILE_ABSENSI';
create index if not exists attendance_import_jobs_scope_idx on public."Attendance_Import_Jobs" ("SPPG","Created_At" desc);
create index if not exists attendance_name_mapping_lookup_idx on public."Attendance_Name_Mappings" ("SPPG","Source_Name_Normalized") where "Is_Active" = true;
