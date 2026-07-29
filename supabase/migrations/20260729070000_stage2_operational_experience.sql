alter table public."Sessions"
  add column if not exists "Last_Activity_At" timestamptz,
  add column if not exists "Client_State" text;

update public."Sessions"
set
  "Last_Activity_At" = coalesce("Last_Activity_At", "Created_At", now()),
  "Client_State" = coalesce(nullif("Client_State", ''), 'ACTIVE')
where "Last_Activity_At" is null
   or "Client_State" is null
   or "Client_State" = '';

alter table public."Sessions"
  alter column "Last_Activity_At" set default now(),
  alter column "Last_Activity_At" set not null,
  alter column "Client_State" set default 'ACTIVE',
  alter column "Client_State" set not null;

alter table public."Sessions"
  drop constraint if exists "Sessions_Client_State_check";

alter table public."Sessions"
  add constraint "Sessions_Client_State_check"
  check ("Client_State" in ('ACTIVE', 'HIDDEN', 'OFFLINE'));

create index if not exists idx_sessions_user_last_activity
  on public."Sessions" ("ID_User", "Last_Activity_At" desc)
  where "Type" = 'user';

alter table public."Pengaduan"
  add column if not exists "Status_Tiket" text,
  add column if not exists "Prioritas" text,
  add column if not exists "Waktu_Status_At" timestamptz,
  add column if not exists "Selesai_At" timestamptz;

update public."Pengaduan"
set
  "Status_Tiket" = coalesce(
    nullif("Status_Tiket", ''),
    case when nullif(trim(coalesce("Tanggapan_Admin", '')), '') is not null then 'DIPROSES' else 'BARU' end
  ),
  "Prioritas" = coalesce(nullif("Prioritas", ''), 'NORMAL'),
  "Waktu_Status_At" = coalesce("Waktu_Status_At", "Waktu_Tanggapan", "Timestamp", now())
where "Status_Tiket" is null
   or "Status_Tiket" = ''
   or "Prioritas" is null
   or "Prioritas" = ''
   or "Waktu_Status_At" is null;

alter table public."Pengaduan"
  alter column "Status_Tiket" set default 'BARU',
  alter column "Status_Tiket" set not null,
  alter column "Prioritas" set default 'NORMAL',
  alter column "Prioritas" set not null,
  alter column "Waktu_Status_At" set default now(),
  alter column "Waktu_Status_At" set not null;

alter table public."Pengaduan"
  drop constraint if exists "Pengaduan_Status_Tiket_check",
  drop constraint if exists "Pengaduan_Prioritas_check";

alter table public."Pengaduan"
  add constraint "Pengaduan_Status_Tiket_check"
    check ("Status_Tiket" in ('BARU', 'DIPROSES', 'MENUNGGU_USER', 'SELESAI')),
  add constraint "Pengaduan_Prioritas_check"
    check ("Prioritas" in ('RENDAH', 'NORMAL', 'TINGGI', 'MENDESAK'));

create index if not exists idx_pengaduan_status_ticket
  on public."Pengaduan" ("Status_Tiket", "Timestamp" desc);

comment on column public."Sessions"."Last_Activity_At" is
  'Heartbeat terakhir dari aplikasi; digunakan untuk indikator online dengan ambang dua menit.';
comment on column public."Sessions"."Client_State" is
  'Status visibilitas aplikasi pada heartbeat terakhir: ACTIVE, HIDDEN, atau OFFLINE.';
comment on column public."Pengaduan"."Status_Tiket" is
  'Tahap penanganan pengaduan: BARU, DIPROSES, MENUNGGU_USER, atau SELESAI.';
comment on column public."Pengaduan"."Prioritas" is
  'Prioritas operasional tiket: RENDAH, NORMAL, TINGGI, atau MENDESAK.';
