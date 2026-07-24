-- Konfigurasi geofence absensi per SPPG.
create table if not exists public."Lokasi_SPPG" (
  "Kunci_SPPG" text primary key,
  "Nama_SPPG" text not null,
  "Latitude" double precision not null check ("Latitude" between -90 and 90),
  "Longitude" double precision not null check ("Longitude" between -180 and 180),
  "Radius_Meter" integer not null default 50 check ("Radius_Meter" between 1 and 50),
  "Aktif" boolean not null default true,
  "Catatan" text,
  "Updated_At" timestamptz not null default now()
);

alter table public."Lokasi_SPPG" enable row level security;
revoke all on table public."Lokasi_SPPG" from anon, authenticated;
grant select, insert, update, delete on table public."Lokasi_SPPG" to service_role;

insert into public."Lokasi_SPPG"
  ("Kunci_SPPG", "Nama_SPPG", "Latitude", "Longitude", "Radius_Meter", "Aktif", "Catatan")
values
  ('DEFAULT', 'Titik sementara SPPG lainnya', -6.918830336350318, 108.07180419931578, 50, true, 'Sementara menggunakan titik SPPG DARMARAJA'),
  ('DARMARAJA', 'DARMARAJA', -6.918830336350318, 108.07180419931578, 50, true, 'Titik resmi yang diberikan'),
  ('TANJUNGMEDAR', 'TANJUNGMEDAR', -6.7313375247490645, 107.88037420565516, 50, true, 'Titik resmi yang diberikan'),
  ('CIAMIS', 'CIAMIS', -6.918830336350318, 108.07180419931578, 50, true, 'Titik sementara sama dengan DARMARAJA'),
  ('CIAWI', 'CIAWI', -6.918830336350318, 108.07180419931578, 50, true, 'Titik sementara sama dengan DARMARAJA'),
  ('CINTAJAYA', 'CINTA JAYA', -6.918830336350318, 108.07180419931578, 50, true, 'Titik sementara sama dengan DARMARAJA'),
  ('CISITU', 'CISITU', -6.918830336350318, 108.07180419931578, 50, true, 'Titik sementara sama dengan DARMARAJA'),
  ('KIRISIK', 'KIRISIK', -6.918830336350318, 108.07180419931578, 50, true, 'Titik sementara sama dengan DARMARAJA'),
  ('PAKUALAM', 'PAKUALAM', -6.918830336350318, 108.07180419931578, 50, true, 'Titik sementara sama dengan DARMARAJA')
on conflict ("Kunci_SPPG") do update set
  "Nama_SPPG" = excluded."Nama_SPPG",
  "Latitude" = excluded."Latitude",
  "Longitude" = excluded."Longitude",
  "Radius_Meter" = excluded."Radius_Meter",
  "Aktif" = excluded."Aktif",
  "Catatan" = excluded."Catatan",
  "Updated_At" = now();

alter table public."Absensi"
  add column if not exists "Latitude" double precision,
  add column if not exists "Longitude" double precision,
  add column if not exists "Akurasi_GPS_Meter" double precision,
  add column if not exists "Jarak_Lokasi_Meter" integer,
  add column if not exists "Radius_Maksimum_Meter" integer,
  add column if not exists "Lokasi_SPPG_Referensi" text;

comment on table public."Lokasi_SPPG" is 'Konfigurasi titik koordinat dan radius maksimum absensi per SPPG.';
comment on column public."Absensi"."Jarak_Lokasi_Meter" is 'Jarak Haversine antara GPS pengguna dan titik SPPG pada saat absensi.';
