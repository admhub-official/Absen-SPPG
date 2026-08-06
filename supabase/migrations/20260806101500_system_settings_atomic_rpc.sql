-- Atomic source of truth for SUPER ADMIN system settings.
create or replace function public.update_system_setting_v1(
  p_key text,
  p_enabled boolean,
  p_user_id text,
  p_description text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'menu.user.complaints',
    'menu.admin.payroll',
    'menu.admin.audit',
    'attendance.geofence_required',
    'attendance.capture_gps_accuracy',
    'attendance.allow_import_single_punch',
    'attendance.correction_requires_audit',
    'payroll.recipient_signature_required',
    'payroll.accountant_signature_required',
    'payroll.head_signature_required',
    'payroll.private_pdf',
    'notification.new_slip',
    'notification.complaint_reply',
    'notification.incomplete_attendance',
    'notification.global_announcement',
    'security.idle_session_expiry',
    'security.revoke_on_password_reset',
    'security.risky_action_reason',
    'security.two_step_confirmation'
  ];
  v_before public."System_Settings"%rowtype;
  v_after public."System_Settings"%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not (p_key = any(v_allowed)) then
    raise exception 'Kunci pengaturan tidak diizinkan.';
  end if;
  if p_enabled is null then
    raise exception 'Nilai aktif/nonaktif wajib diisi.';
  end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then
    raise exception 'Alasan perubahan wajib 10 sampai 500 karakter.';
  end if;

  select * into v_before
  from public."System_Settings"
  where "Setting_Key" = p_key
  for update;

  if not found then
    raise exception 'Pengaturan tidak ditemukan.';
  end if;

  update public."System_Settings"
  set "Setting_Value" = jsonb_set(coalesce("Setting_Value", '{}'::jsonb), '{enabled}', to_jsonb(p_enabled), true),
      "Description" = left(coalesce(nullif(btrim(p_description), ''), "Description", p_key), 500),
      "Updated_At" = clock_timestamp(),
      "Updated_By" = p_user_id
  where "Setting_Key" = p_key
  returning * into v_after;

  insert into public."Audit_Log"(
    "ID_Log", "Waktu", "ID_User_Pelaku", "Jenis_Aktivitas", "Detail", "IP_Address"
  ) values (
    'LOG_' || replace(gen_random_uuid()::text, '-', ''),
    clock_timestamp(),
    p_user_id,
    'UPDATE_SYSTEM_SETTING',
    jsonb_build_object(
      'object', p_key,
      'reason', v_reason,
      'before', to_jsonb(v_before),
      'after', to_jsonb(v_after),
      'source', 'SystemSettings'
    ),
    'N/A'
  );

  return to_jsonb(v_after);
end;
$$;

revoke all on function public.update_system_setting_v1(text, boolean, text, text, text) from public;
grant execute on function public.update_system_setting_v1(text, boolean, text, text, text) to service_role;
