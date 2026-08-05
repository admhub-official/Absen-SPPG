create table if not exists public."Payroll_TTD_Massal_Job" (
  "ID_Job" text primary key,
  "Dibuat_Oleh" text not null,
  "Nama_Akuntan" text not null,
  "Nama_Kepala_SPPG" text not null,
  "TTD_Akuntan_Path" text not null,
  "TTD_Kepala_SPPG_Path" text not null,
  "Total_Item" integer not null default 0,
  "Selesai_Item" integer not null default 0,
  "Gagal_Item" integer not null default 0,
  "Status" text not null default 'ANTRI',
  "Pesan_Error" text,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  "Selesai_At" timestamptz
);

create table if not exists public."Payroll_TTD_Massal_Item" (
  "ID_Job" text not null references public."Payroll_TTD_Massal_Job"("ID_Job") on delete cascade,
  "ID_Slip" text not null,
  "Status" text not null default 'ANTRI',
  "Pesan_Error" text,
  "Updated_At" timestamptz not null default now(),
  primary key ("ID_Job", "ID_Slip")
);

create index if not exists payroll_ttd_massal_item_status_idx
  on public."Payroll_TTD_Massal_Item" ("ID_Job", "Status");
