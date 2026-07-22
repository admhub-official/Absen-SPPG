create index if not exists idx_device_absen_dibuat_oleh on public."Device_Absen" ("Dibuat_Oleh");
create index if not exists idx_email_otp_id_user on public."Email_OTP" ("ID_User");
create index if not exists idx_payroll_diproses_oleh on public."Payroll" ("Diproses_Oleh");
create index if not exists idx_pengaduan_ditanggapi_oleh on public."Pengaduan" ("Ditanggapi_Oleh");

alter function public.cleanup_expired_sessions() set search_path = public;
alter function public.sync_email_verified() set search_path = public;
