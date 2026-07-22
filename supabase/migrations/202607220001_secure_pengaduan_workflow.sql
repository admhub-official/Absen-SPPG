alter table public."Pengaduan"
  add column if not exists "SPPG" text,
  add column if not exists "Yayasan" text,
  add column if not exists "Ditanggapi_Oleh" text,
  add column if not exists "Waktu_Tanggapan" timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'Pengaduan_Ditanggapi_Oleh_fkey'
  ) then
    alter table public."Pengaduan"
      add constraint "Pengaduan_Ditanggapi_Oleh_fkey"
      foreign key ("Ditanggapi_Oleh") references public."Users"("ID_User")
      on update cascade on delete set null;
  end if;
end $$;

create index if not exists idx_pengaduan_timestamp_desc
  on public."Pengaduan" ("Timestamp" desc);
create index if not exists idx_pengaduan_user_status
  on public."Pengaduan" ("User", "Status_Baca");

comment on column public."Pengaduan"."User" is
  'Relasi internal pengirim. Tidak pernah dikirim ke ADMIN untuk laporan anonim; hanya SUPER ADMIN dan pemilik laporan.';
comment on column public."Pengaduan"."SPPG" is
  'Snapshot SPPG pengirim untuk routing laporan ke admin sesuai cakupan.';
comment on column public."Pengaduan"."Ditanggapi_Oleh" is
  'Admin atau Super Admin terakhir yang memberi tanggapan.';
comment on column public."Pengaduan"."Waktu_Tanggapan" is
  'Waktu tanggapan terakhir disimpan.';

alter table public."Pengaduan" enable row level security;
revoke all on table public."Pengaduan" from anon, authenticated;
