-- Sprint 1: integritas presensi, waktu server, state validation, dan idempotency API.

create table if not exists public."API_Idempotency" (
  "Idempotency_Key" text primary key,
  "Function_Name" text not null,
  "Request_Fingerprint" text not null,
  "Status" text not null default 'PROCESSING' check ("Status" in ('PROCESSING','COMPLETED','FAILED')),
  "HTTP_Status" integer,
  "Response_Body" jsonb,
  "Created_At" timestamptz not null default now(),
  "Completed_At" timestamptz,
  "Expires_At" timestamptz not null default (now() + interval '24 hours')
);

create index if not exists "API_Idempotency_Expires_At_idx"
  on public."API_Idempotency" ("Expires_At");

alter table public."API_Idempotency" enable row level security;
revoke all on public."API_Idempotency" from anon, authenticated;

create or replace function public.enforce_self_attendance_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_date date := (v_now at time zone 'Asia/Jakarta')::date;
  v_kind text := upper(coalesce(new."Jenis_Absen", ''));
  v_status text := upper(coalesce(new."Status_Validasi", ''));
  v_is_self boolean := upper(coalesce(new."ID_Device", '')) like 'SELF_%';
  v_has_in boolean;
  v_has_out boolean;
begin
  -- Hanya presensi mandiri yang diwajibkan memakai waktu server. Data impor dan
  -- perangkat administratif tetap mempertahankan timestamp sumbernya.
  if v_is_self then
    new."Waktu_Timestamp" := v_now;
    new."Tanggal" := v_date;
  end if;

  -- Rekam gagal verifikasi tetap boleh disimpan untuk audit, tetapi tidak
  -- mengubah state kehadiran resmi.
  if not v_is_self or v_status <> 'VALID' or v_kind not in ('DATANG','PULANG') then
    return new;
  end if;

  -- Serialisasi seluruh perubahan state user pada tanggal kerja yang sama.
  perform pg_advisory_xact_lock(hashtextextended(new."ID_User"::text || ':' || v_date::text, 0));

  select exists (
    select 1 from public."Absensi" a
    where a."ID_User" = new."ID_User"
      and a."Tanggal" = v_date
      and upper(coalesce(a."Status_Validasi", '')) = 'VALID'
      and upper(coalesce(a."Jenis_Absen", '')) in ('DATANG','PUNCH_TUNGGAL')
  ) into v_has_in;

  select exists (
    select 1 from public."Absensi" a
    where a."ID_User" = new."ID_User"
      and a."Tanggal" = v_date
      and upper(coalesce(a."Status_Validasi", '')) = 'VALID'
      and upper(coalesce(a."Jenis_Absen", '')) = 'PULANG'
  ) into v_has_out;

  if v_kind = 'DATANG' and v_has_in then
    raise exception using errcode = '23505', message = 'ATTENDANCE_DUPLICATE_IN';
  end if;

  if v_kind = 'PULANG' and not v_has_in then
    raise exception using errcode = '23514', message = 'ATTENDANCE_CHECKOUT_BEFORE_CHECKIN';
  end if;

  if v_kind = 'PULANG' and v_has_out then
    raise exception using errcode = '23505', message = 'ATTENDANCE_DUPLICATE_OUT';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_self_attendance_integrity on public."Absensi";
create trigger trg_enforce_self_attendance_integrity
before insert on public."Absensi"
for each row execute function public.enforce_self_attendance_integrity();

comment on function public.enforce_self_attendance_integrity() is
  'Menetapkan waktu server dan memvalidasi transisi DATANG/PULANG untuk presensi mandiri secara atomik.';
