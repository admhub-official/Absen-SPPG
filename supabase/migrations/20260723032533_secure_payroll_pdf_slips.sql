-- Secure, server-generated payroll slips with private Storage downloads.

alter table public."Payroll"
  add column if not exists "Status_Penerbitan" text not null default 'DRAFT',
  add column if not exists "Diterbitkan_At" timestamptz,
  add column if not exists "Diterbitkan_Oleh" text,
  add column if not exists "Nama_Penerbit" text;

alter table public."Slip_Gaji"
  add column if not exists "SPPG" text,
  add column if not exists "Yayasan" text,
  add column if not exists "Status_Penerbitan" text not null default 'DRAFT',
  add column if not exists "Diterbitkan_At" timestamptz,
  add column if not exists "Diterbitkan_Oleh" text,
  add column if not exists "Nama_Penerbit" text,
  add column if not exists "Dicetak_At" timestamptz,
  add column if not exists "PDF_Storage_Path" text,
  add column if not exists "PDF_SHA256" text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public."Payroll"'::regclass
      and conname = 'Payroll_Diterbitkan_Oleh_fkey'
  ) then
    alter table public."Payroll"
      add constraint "Payroll_Diterbitkan_Oleh_fkey"
      foreign key ("Diterbitkan_Oleh")
      references public."Users" ("ID_User")
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public."Slip_Gaji"'::regclass
      and conname = 'Slip_Gaji_Diterbitkan_Oleh_fkey'
  ) then
    alter table public."Slip_Gaji"
      add constraint "Slip_Gaji_Diterbitkan_Oleh_fkey"
      foreign key ("Diterbitkan_Oleh")
      references public."Users" ("ID_User")
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public."Payroll"'::regclass
      and conname = 'Payroll_Status_Penerbitan_check'
  ) then
    alter table public."Payroll"
      add constraint "Payroll_Status_Penerbitan_check"
      check ("Status_Penerbitan" in ('DRAFT', 'DIPROSES', 'DITERBITKAN', 'GAGAL'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public."Slip_Gaji"'::regclass
      and conname = 'Slip_Gaji_Status_Penerbitan_check'
  ) then
    alter table public."Slip_Gaji"
      add constraint "Slip_Gaji_Status_Penerbitan_check"
      check ("Status_Penerbitan" in ('DRAFT', 'DITERBITKAN', 'DIBATALKAN'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public."Slip_Gaji"'::regclass
      and conname = 'Slip_Gaji_Period_check'
  ) then
    alter table public."Slip_Gaji"
      add constraint "Slip_Gaji_Period_check"
      check ("Periode_Akhir" is null or "Periode_Mulai" is null or "Periode_Akhir" >= "Periode_Mulai");
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public."Slip_Gaji"'::regclass
      and conname = 'Slip_Gaji_Nominal_check'
  ) then
    alter table public."Slip_Gaji"
      add constraint "Slip_Gaji_Nominal_check"
      check (
        coalesce("Jumlah_Hari_Kerja", 0) >= 0
        and coalesce("Gaji_Harian", 0) >= 0
        and coalesce("Subtotal_Gaji", 0) >= 0
        and coalesce("Bonus", 0) >= 0
        and coalesce("Potongan", 0) >= 0
        and coalesce("Total_Gaji_Diterima", 0) >= 0
      );
  end if;
end
$$;

create index if not exists idx_payroll_diterbitkan_oleh
  on public."Payroll" ("Diterbitkan_Oleh");

create index if not exists idx_payroll_status_periode
  on public."Payroll" ("Status_Penerbitan", "Periode_Mulai" desc, "Periode_Akhir" desc);

create index if not exists idx_slip_diterbitkan_oleh
  on public."Slip_Gaji" ("Diterbitkan_Oleh");

create index if not exists idx_slip_user_published
  on public."Slip_Gaji" ("ID_User", "Diterbitkan_At" desc)
  where "Status_Penerbitan" = 'DITERBITKAN';

create unique index if not exists uq_slip_user_exact_published_period
  on public."Slip_Gaji" ("ID_User", "Periode_Mulai", "Periode_Akhir")
  where "Status_Penerbitan" = 'DITERBITKAN';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('slip-gaji', 'slip-gaji', false, 10485760, array['application/pdf']),
  ('tanda-tangan', 'tanda-tangan', false, 5242880, array['image/png'])
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public."Payroll" enable row level security;
alter table public."Slip_Gaji" enable row level security;

revoke all on table public."Payroll" from anon, authenticated;
revoke all on table public."Slip_Gaji" from anon, authenticated;
grant all on table public."Payroll" to service_role;
grant all on table public."Slip_Gaji" to service_role;
