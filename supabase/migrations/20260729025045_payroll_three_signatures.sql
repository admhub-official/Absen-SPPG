-- Add BGN branding and a three-signature payroll workflow.
-- Applied to Supabase as migration 20260729025045.

alter table public."Payroll"
  add column if not exists "Nama_Akuntan" text,
  add column if not exists "TTD_Akuntan_Path" text,
  add column if not exists "Nama_Kepala_SPPG" text,
  add column if not exists "TTD_Kepala_SPPG_Path" text,
  add column if not exists "Logo_BGN_Path" text;

alter table public."Slip_Gaji"
  add column if not exists "TTD_Penerima_Path" text,
  add column if not exists "Ditandatangani_Penerima_At" timestamptz;

alter table public."Payroll"
  drop constraint if exists "Payroll_Status_Penerbitan_check";

alter table public."Payroll"
  add constraint "Payroll_Status_Penerbitan_check"
  check (
    "Status_Penerbitan" in (
      'DRAFT',
      'DIPROSES',
      'MENUNGGU_TTD_PENERIMA',
      'DITERBITKAN',
      'GAGAL'
    )
  );

alter table public."Slip_Gaji"
  drop constraint if exists "Slip_Gaji_Status_Penerbitan_check";

alter table public."Slip_Gaji"
  add constraint "Slip_Gaji_Status_Penerbitan_check"
  check (
    "Status_Penerbitan" in (
      'DRAFT',
      'MENUNGGU_TTD_PENERIMA',
      'DITERBITKAN',
      'DIBATALKAN'
    )
  );

drop index if exists public.uq_slip_user_exact_published_period;

create unique index if not exists uq_slip_user_active_period
  on public."Slip_Gaji" ("ID_User", "Periode_Mulai", "Periode_Akhir")
  where "Status_Penerbitan" in ('MENUNGGU_TTD_PENERIMA', 'DITERBITKAN');

create index if not exists idx_slip_waiting_recipient_signature
  on public."Slip_Gaji" ("ID_User", "Diterbitkan_At" desc)
  where "Status_Penerbitan" = 'MENUNGGU_TTD_PENERIMA';

insert into public."Master_Jabatan" (
  "ID_Master_Jabatan",
  "Nama_Jabatan",
  "Aktif"
)
select
  'JBT_' || floor(extract(epoch from clock_timestamp()))::bigint::text || '_KEPALASPPG',
  'KEPALA SPPG',
  true
where not exists (
  select 1
  from public."Master_Jabatan"
  where upper(trim("Nama_Jabatan")) = 'KEPALA SPPG'
);
